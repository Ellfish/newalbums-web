/**
 * User-token Spotify calls, ported from SpotifyAppService (GetFollowedArtists,
 * GetTopArtistIds, GetUserEmail). The client-credentials calls used by the NAS
 * job's album polling are NOT ported - they stay on the NAS.
 */

// Ported from SpotifyConsts
const MAX_LIMIT_FOLLOWED_ARTISTS = 50; // enforced by Spotify
const MAX_TOTAL_FOLLOWED_ARTISTS = 50 * 200; // enforced by us
const MAX_LIMIT_TOP_ARTISTS = 50; // enforced by Spotify, no paging

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

export interface SpotifyImage {
	url: string;
	width: number;
	height: number;
}

export interface SpotifyArtist {
	id: string;
	name: string;
	image: SpotifyImage;
	selected: boolean;
}

const DEFAULT_IMAGE: SpotifyImage = {
	url: '/images/default-artist-image.png',
	width: 0,
	height: 0,
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with rate-limit handling, ported from HandleRateLimitingError:
 * on 429, wait Retry-After (+1 second safety margin) and retry, capped.
 */
async function spotifyFetch(url: string, accessToken: string): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${accessToken}` },
		});

		if (response.status === 429 && attempt < 5) {
			const retryAfterSeconds = Number(response.headers.get('Retry-After') ?? '1') + 1;
			await sleep(retryAfterSeconds * 1000);
			continue;
		}

		return response;
	}
}

async function assertOk(response: Response): Promise<void> {
	if (!response.ok) {
		let message = `Spotify API error: ${response.status}`;
		try {
			const body = (await response.json()) as { error?: { message?: string } };
			if (body?.error?.message) message = body.error.message;
		} catch {
			// keep the status-based message
		}
		throw new Error(message);
	}
}

/**
 * Ported from GetFollowedArtists + GetTopArtistIds. Returns all followed
 * artists (sorted by name) with top artists preselected, like the old API.
 */
export async function getFollowedArtists(accessToken: string): Promise<SpotifyArtist[]> {
	//Top artists are only used to preselect - never fail the request if this
	//errors (same as .NET), but log it so failures are diagnosable in Worker logs
	const topArtistIds = await getTopArtistIds(accessToken).catch((e) => {
		console.error(
			'Error getting top artists for preselection:',
			e instanceof Error ? e.message : String(e),
		);
		return [] as string[];
	});

	const followedArtists: SpotifyArtist[] = [];
	let afterArtistId: string | undefined;
	let pagesLeft = Math.floor(MAX_TOTAL_FOLLOWED_ARTISTS / MAX_LIMIT_FOLLOWED_ARTISTS);

	while (pagesLeft > 0) {
		const url = new URL(`${SPOTIFY_API_BASE}/me/following`);
		url.searchParams.set('type', 'artist');
		url.searchParams.set('limit', String(MAX_LIMIT_FOLLOWED_ARTISTS));
		if (afterArtistId) url.searchParams.set('after', afterArtistId);

		const response = await spotifyFetch(url.toString(), accessToken);
		await assertOk(response);
		const body = (await response.json()) as {
			artists: {
				items: {
					id: string;
					name: string;
					images: { url: string; width: number; height: number }[];
				}[];
				next: string | null;
			};
		};

		const items = body.artists?.items ?? [];
		if (items.length === 0) break;

		for (const item of items) {
			followedArtists.push({
				id: item.id,
				name: item.name,
				image: getImage(item.images, 100),
				selected: topArtistIds.includes(item.id),
			});
		}

		if (!body.artists?.next) break;

		afterArtistId = items[items.length - 1]?.id;
		pagesLeft--;
	}

	if (followedArtists.length === 0) {
		throw new Error("You're not currently following any artists.");
	}

	followedArtists.sort((a, b) => a.name.localeCompare(b.name));
	return followedArtists;
}

async function getTopArtistIds(accessToken: string): Promise<string[]> {
	// Endpoint is GET /me/top/{type} - note the SLASH: /me/top-artists returns 410 Gone
	const url = new URL(`${SPOTIFY_API_BASE}/me/top/artists`);
	url.searchParams.set('time_range', 'long_term');
	url.searchParams.set('limit', String(MAX_LIMIT_TOP_ARTISTS));

	const response = await spotifyFetch(url.toString(), accessToken);
	await assertOk(response);
	const body = (await response.json()) as { items: { id: string }[] };

	return (body.items ?? []).map((item) => item.id);
}

/** Ported from GetUserEmail */
export async function getUserEmail(accessToken: string): Promise<string> {
	const response = await spotifyFetch(`${SPOTIFY_API_BASE}/me`, accessToken);
	await assertOk(response);
	const body = (await response.json()) as { email?: string };

	if (!body.email) {
		throw new Error('Spotify did not return an email address for this account.');
	}

	return body.email;
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
