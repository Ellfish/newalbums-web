import { env } from 'cloudflare:workers';

/**
 * Server-side Spotify client using the Client Credentials flow: every call is
 * made with the APP's own token (client ID + secret, held as Worker secrets),
 * never a user's token. This is what keeps the app working under Spotify's
 * February 2026 development-mode rules: there is no user authorization
 * anywhere, so the 5-authorized-user cap never applies.
 *
 * Covers the artist search + playlist import used by the subscribe flow. The
 * album polling calls used by the NAS job stay in the private .NET repo.
 */

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

const MAX_SEARCH_LIMIT = 10; // Spotify dev-mode cap (was 50) since Feb 2026
const PLAYLIST_PAGE_SIZE = 100; // enforced by Spotify
const MAX_PLAYLIST_PAGES = 10; // enforced by us: we read at most the first 1,000 tracks
const MAX_API_ATTEMPTS = 6; // 1 initial + rate-limit retries (a 401 refresh consumes one too)
const TOKEN_EXPIRY_MARGIN_MS = 300_000; // refresh 5 minutes early

export interface SpotifyImage {
	url: string;
	width: number;
	height: number;
}

/** An artist as returned to the artist picker (search results) */
export interface SpotifyArtistSummary {
	id: string;
	name: string;
	image: SpotifyImage;
}

/** An artist extracted from a playlist, plus how many of its tracks featured them */
export interface PlaylistArtist extends SpotifyArtistSummary {
	trackCount: number;
}

export interface PlaylistArtistsResult {
	playlistName: string | null;
	tracksTotal: number | null;
	artists: PlaylistArtist[];
}

const DEFAULT_IMAGE: SpotifyImage = {
	url: '/images/default-artist-image.png',
	width: 0,
	height: 0,
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Client-credentials token ----------------------------------------------

//Cached per Worker isolate: client-credentials tokens can't be refreshed, just
//re-requested, so we hold one until shortly before it expires
let cachedToken: { token: string; expiresAt: number } | null = null;

/** Test hook: forget the cached app token */
export function clearCachedAppToken(): void {
	cachedToken = null;
}

function getSpotifyCredentials(): { clientId: string; clientSecret: string } {
	//Read lazily (not at module scope), like getAppConfig()
	const clientId = env.SPOTIFY_CLIENT_ID;
	const clientSecret = env.SPOTIFY_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error('Spotify API is not configured (missing client ID/secret).');
	}
	return { clientId, clientSecret };
}

export async function getAppAccessToken(): Promise<string> {
	const now = Date.now();
	if (cachedToken && cachedToken.expiresAt > now) return cachedToken.token;

	const { clientId, clientSecret } = getSpotifyCredentials();
	const response = await fetch(SPOTIFY_TOKEN_URL, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
	});
	const body = (await response.json().catch(() => null)) as
		| { access_token?: string; expires_in?: number; error?: string; error_description?: string }
		| null;

	if (!response.ok || !body?.access_token) {
		throw new Error(
			body?.error_description ?? body?.error ?? `Spotify token request failed (${response.status}).`,
		);
	}

	cachedToken = {
		token: body.access_token,
		expiresAt: now + (body.expires_in ?? 3600) * 1000 - TOKEN_EXPIRY_MARGIN_MS,
	};
	return body.access_token;
}

// ---- Fetch helpers ----------------------------------------------------------

export const QUOTA_EXCEEDED_MESSAGE =
	"Spotify's developer quota for this app has been exceeded. Please try again later.";
const RATE_LIMITED_MESSAGE = 'Spotify is rate limiting requests from this app. Please try again shortly.';

/**
 * GET with the app token. Ported from HandleRateLimitingError: on 429, honour
 * Retry-After (capped - a Worker can't sleep for hours) and retry. A 429 with
 * reason QUOTA_EXCEEDED is the dev-mode quota (a separate mechanism from rate
 * limits, counted per developer account) and is surfaced immediately, because
 * retrying it is pointless. A 401 means our cached token was invalidated:
 * drop it so the next attempt requests a fresh one (the attempt cap means
 * this refresh only happens once).
 */
async function apiFetch(url: string): Promise<Response> {
	for (let attempt = 0; attempt < MAX_API_ATTEMPTS; attempt++) {
		const token = await getAppAccessToken();
		const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

		if (response.status === 429) {
			const body = (await response.json().catch(() => null)) as { reason?: string } | null;
			if (body?.reason === 'QUOTA_EXCEEDED') throw new Error(QUOTA_EXCEEDED_MESSAGE);
			if (attempt === MAX_API_ATTEMPTS - 1) throw new Error(RATE_LIMITED_MESSAGE);

			const retryAfterSeconds = Math.min(Number(response.headers.get('Retry-After') ?? '1') + 1, 5);
			await sleep(retryAfterSeconds * 1000);
			continue;
		}

		if (response.status === 401) {
			cachedToken = null;
			continue;
		}

		return response;
	}

	throw new Error(RATE_LIMITED_MESSAGE);
}

async function assertOk(response: Response): Promise<void> {
	if (response.ok) return;

	let message = `Spotify API error: ${response.status}`;
	try {
		const body = (await response.json()) as { error?: { message?: string } };
		if (body?.error?.message) message = body.error.message;
	} catch {
		// keep the status-based message
	}
	throw new Error(message);
}

// ---- Search -----------------------------------------------------------------

/**
 * Market used for search availability filtering: the visitor's country
 * (Cloudflare's request.cf IP geolocation) when it's a valid ISO 3166-1 alpha-2
 * code, else the configured default.
 */
export function resolveMarket(country: string | null | undefined, defaultMarket: string): string {
	if (country && /^[A-Za-z]{2}$/.test(country)) return country.toUpperCase();
	return defaultMarket;
}

interface RawArtist {
	id?: string;
	name?: string;
	images?: { url: string; width: number; height: number }[];
}

export async function searchArtists(query: string, market: string): Promise<SpotifyArtistSummary[]> {
	const url = new URL(`${SPOTIFY_API_BASE}/search`);
	url.searchParams.set('type', 'artist');
	url.searchParams.set('q', query);
	url.searchParams.set('market', market);
	url.searchParams.set('limit', String(MAX_SEARCH_LIMIT));

	const response = await apiFetch(url.toString());
	await assertOk(response);
	const body = (await response.json()) as { artists?: { items?: RawArtist[] } };

	return (body.artists?.items ?? [])
		.filter((artist) => artist?.id && artist.name)
		.map((artist) => ({ id: artist.id!, name: artist.name!, image: getImage(artist.images, 100) }));
}

// ---- Playlist import --------------------------------------------------------

export const INVALID_PLAYLIST_INPUT_MESSAGE =
	"That doesn't look like a Spotify playlist link. Paste a link like https://open.spotify.com/playlist/…";

const PLAYLIST_NOT_FOUND_MESSAGE =
	"Playlist not found. Check the link - and note that private playlists and Spotify's own playlists (like Today's Top Hits or Discover Weekly) can't be imported.";
const PLAYLIST_EMPTY_MESSAGE = 'That playlist is empty.';
const PLAYLIST_CONTENTS_UNAVAILABLE_MESSAGE =
	"Spotify didn't return the contents of that playlist. It may be private, or Spotify may no longer allow reading other people's playlists - try searching for the artists instead.";

/**
 * Accepts the forms people actually paste: an open.spotify.com playlist URL
 * (with or without query params, including /embed/ links), a spotify:playlist:
 * URI, or a bare playlist ID. Spotify IDs are 22 base62 characters.
 * Returns the playlist ID, or null if the input isn't one.
 */
export function parsePlaylistInput(input: string): string | null {
	const trimmed = input.trim();

	const urlMatch = /^https?:\/\/open\.spotify\.com\/(?:embed\/)?playlist\/([A-Za-z0-9]+)/.exec(trimmed);
	const uriMatch = /^spotify:playlist:([A-Za-z0-9]+)/.exec(trimmed);
	const id = urlMatch?.[1] ?? uriMatch?.[1] ?? (/^[A-Za-z0-9]+$/.test(trimmed) ? trimmed : undefined);

	return id !== undefined && /^[A-Za-z0-9]{22}$/.test(id) ? id : null;
}

interface RawTrack {
	is_local?: boolean;
	artists?: { id?: string; name?: string }[];
	album?: { images?: { url: string; width: number; height: number }[] };
}

/**
 * One entry of GET /playlists/{id}/items. `item` is the new field name, `track`
 * the old one - both are present during Spotify's transition, so read either.
 * Entries are null for removed/unavailable tracks.
 */
interface PlaylistItemEntry {
	item?: RawTrack | null;
	track?: RawTrack | null;
}

export async function getPlaylistArtistsById(playlistId: string): Promise<PlaylistArtistsResult> {
	//Playlist metadata (name/total) for the import status line
	const metaResponse = await apiFetch(`${SPOTIFY_API_BASE}/playlists/${playlistId}`);
	if (metaResponse.status === 404 || metaResponse.status === 403) throw new Error(PLAYLIST_NOT_FOUND_MESSAGE);
	await assertOk(metaResponse);
	const meta = (await metaResponse.json()) as {
		name?: string;
		tracks?: { total?: number };
		items?: { total?: number };
	};
	const playlistName = typeof meta.name === 'string' ? meta.name : null;
	const tracksTotal = meta.tracks?.total ?? meta.items?.total ?? null;

	const byId = new Map<string, PlaylistArtist>();
	let offset = 0;
	let tracksSeen = 0;

	for (let page = 0; page < MAX_PLAYLIST_PAGES; page++) {
		const url = new URL(`${SPOTIFY_API_BASE}/playlists/${playlistId}/items`);
		url.searchParams.set('limit', String(PLAYLIST_PAGE_SIZE));
		url.searchParams.set('offset', String(offset));

		const response = await apiFetch(url.toString());
		if (response.status === 404 || response.status === 403) throw new Error(PLAYLIST_NOT_FOUND_MESSAGE);
		await assertOk(response);
		const body = (await response.json()) as { items?: PlaylistItemEntry[]; total?: number };

		const entries = body.items ?? [];
		if (entries.length === 0) break;

		for (const entry of entries) {
			const track = entry?.item ?? entry?.track;
			if (!track || track.is_local) continue;

			for (const artist of track.artists ?? []) {
				if (!artist?.id || !artist.name) continue;

				const existing = byId.get(artist.id);
				if (existing) {
					existing.trackCount++;
				} else {
					byId.set(artist.id, {
						id: artist.id,
						name: artist.name,
						//Playlist track entries have no artist images, so imported tiles
						//show the track's album art instead
						image: getImage(track.album?.images, 100),
						trackCount: 1,
					});
				}
			}
		}

		tracksSeen += entries.length;
		offset += entries.length;

		if (typeof body.total === 'number' && tracksSeen >= body.total) break;
	}

	if (byId.size === 0) {
		if (tracksTotal === 0) throw new Error(PLAYLIST_EMPTY_MESSAGE);
		throw new Error(PLAYLIST_CONTENTS_UNAVAILABLE_MESSAGE);
	}

	//Most frequently featured artists first, name as a tiebreaker
	const artists = [...byId.values()].sort(
		(a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name),
	);

	return { playlistName, tracksTotal, artists };
}

/** Convenience wrapper: parse then fetch (endpoints parse first so they can key their response caches) */
export async function getPlaylistArtists(input: string): Promise<PlaylistArtistsResult> {
	const playlistId = parsePlaylistInput(input);
	if (!playlistId) throw new Error(INVALID_PLAYLIST_INPUT_MESSAGE);
	return getPlaylistArtistsById(playlistId);
}

/**
 * Ported from GetImage: finds the smallest image over minWidth wide.
 * If no images meet this criteria, returns the default image.
 */
function getImage(
	apiImages: { url: string; width: number; height: number }[] | undefined,
	minWidth: number,
): SpotifyImage {
	if (!apiImages || apiImages.length === 0) return DEFAULT_IMAGE;

	const candidates = apiImages
		.filter((image) => (image.width ?? 0) >= minWidth)
		.sort((a, b) => (a.width ?? 0) - (b.width ?? 0));

	const image = candidates[0];
	if (image) {
		return { url: image.url, width: image.width, height: image.height };
	}

	return DEFAULT_IMAGE;
}
