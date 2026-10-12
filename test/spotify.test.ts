import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearCachedAppToken,
	getAppAccessToken,
	getPlaylistArtists,
	parsePlaylistInput,
	QUOTA_EXCEEDED_MESSAGE,
	resolveMarket,
	searchArtists,
} from '../src/lib/spotify';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const APP_TOKEN = 'test-app-token';
const PLAYLIST_ID = '4ZOU5KyfsGiq5iMjDAwhRq';

interface RecordedCall {
	url: string;
	init?: RequestInit;
}

/** Stubs global fetch, recording every call; the handler routes by URL */
function recordFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>): RecordedCall[] {
	const calls: RecordedCall[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input));
			calls.push({ url: url.toString(), init });
			return handler(url, init);
		}),
	);
	return calls;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), { status, headers });
}

/** The standard token response for every test that needs an app token */
function tokenResponse(): Response {
	return json({ access_token: APP_TOKEN, token_type: 'Bearer', expires_in: 3600 });
}

function authHeader(init?: RequestInit): string {
	const headers = init?.headers as Record<string, string> | undefined;
	return headers?.Authorization ?? '';
}

beforeEach(() => {
	clearCachedAppToken();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('resolveMarket', () => {
	it('uses the visitor country when valid, uppercased', () => {
		expect(resolveMarket('AU', 'AU')).toBe('AU');
		expect(resolveMarket('nz', 'AU')).toBe('NZ');
	});

	it('falls back to the default for anything that is not a 2-letter country code', () => {
		expect(resolveMarket(undefined, 'AU')).toBe('AU');
		expect(resolveMarket('', 'US')).toBe('US');
		expect(resolveMarket('AUS', 'AU')).toBe('AU');
		expect(resolveMarket('9!', 'AU')).toBe('AU');
	});
});

describe('parsePlaylistInput', () => {
	it('accepts open.spotify.com URLs, spotify: URIs and bare IDs', () => {
		expect(parsePlaylistInput(`https://open.spotify.com/playlist/${PLAYLIST_ID}`)).toBe(PLAYLIST_ID);
		expect(parsePlaylistInput(`https://open.spotify.com/playlist/${PLAYLIST_ID}?si=shared`)).toBe(PLAYLIST_ID);
		expect(parsePlaylistInput(`https://open.spotify.com/embed/playlist/${PLAYLIST_ID}`)).toBe(PLAYLIST_ID);
		expect(parsePlaylistInput(`spotify:playlist:${PLAYLIST_ID}`)).toBe(PLAYLIST_ID);
		expect(parsePlaylistInput(PLAYLIST_ID)).toBe(PLAYLIST_ID);
	});

	it('trims surrounding whitespace', () => {
		expect(parsePlaylistInput(`  https://open.spotify.com/playlist/${PLAYLIST_ID} \n`)).toBe(PLAYLIST_ID);
	});

	it('rejects everything that is not a 22-char base62 playlist ID', () => {
		expect(parsePlaylistInput('')).toBeNull();
		expect(parsePlaylistInput(`https://open.spotify.com/track/${PLAYLIST_ID}`)).toBeNull();
		expect(parsePlaylistInput(`spotify:album:${PLAYLIST_ID}`)).toBeNull();
		expect(parsePlaylistInput('https://open.spotify.com/playlist/tooShort')).toBeNull();
		expect(parsePlaylistInput(`${PLAYLIST_ID}X`)).toBeNull(); //23 chars
		expect(parsePlaylistInput('4ZOU5KyfsGiq5iMjDAwhR$')).toBeNull(); //invalid character
	});
});

describe('getAppAccessToken', () => {
	it('requests a client-credentials token with Basic auth, and caches it until near expiry', async () => {
		const calls = recordFetch((url) => (url.toString() === TOKEN_URL ? tokenResponse() : json({}, 500)));

		expect(await getAppAccessToken()).toBe(APP_TOKEN);
		expect(authHeader(calls[0]?.init)).toBe(`Basic ${btoa('test-client-id:test-client-secret')}`);

		//Cached: a second call must not hit the token endpoint again
		await getAppAccessToken();
		expect(calls.filter((call) => call.url === TOKEN_URL)).toHaveLength(1);
	});

	it('throws the error_description when the token request fails', async () => {
		recordFetch(() => json({ error: 'invalid_client', error_description: 'Client authentication failed' }, 401));

		await expect(getAppAccessToken()).rejects.toThrow('Client authentication failed');
	});
});

describe('searchArtists', () => {
	it('searches with the dev-mode limit of 10, the given market and the app token', async () => {
		const calls = recordFetch((url) => {
			if (url.toString() === TOKEN_URL) return tokenResponse();
			if (url.pathname === '/v1/search') {
				return json({
					artists: {
						items: [
							{
								id: 'artist-1',
								name: 'Crowded House',
								images: [
									{ url: 'https://img/640.jpg', width: 640, height: 640 },
									{ url: 'https://img/160.jpg', width: 160, height: 160 },
								],
							},
							{ id: 'artist-2', name: 'No Images' },
							{ name: 'No ID - filtered out' },
						],
					},
				});
			}
			return json({ error: { message: `unexpected URL ${url.toString()}` } }, 500);
		});

		const artists = await searchArtists('crowded house', 'NZ');

		expect(artists).toEqual([
			{
				id: 'artist-1',
				name: 'Crowded House',
				//getImage picks the smallest image at least 100px wide
				image: { url: 'https://img/160.jpg', width: 160, height: 160 },
			},
			{
				id: 'artist-2',
				name: 'No Images',
				image: { url: '/images/default-artist-image.png', width: 0, height: 0 },
			},
		]);

		const searchUrl = new URL(calls.find((call) => call.url.includes('/v1/search'))!.url);
		expect(searchUrl.searchParams.get('type')).toBe('artist');
		expect(searchUrl.searchParams.get('q')).toBe('crowded house');
		expect(searchUrl.searchParams.get('market')).toBe('NZ');
		expect(searchUrl.searchParams.get('limit')).toBe('10');
		expect(authHeader(calls.find((call) => call.url.includes('/v1/search'))?.init)).toBe(`Bearer ${APP_TOKEN}`);
	});

	it('surfaces a 429 QUOTA_EXCEEDED immediately, without retrying', async () => {
		const calls = recordFetch((url) => {
			if (url.toString() === TOKEN_URL) return tokenResponse();
			return json({ reason: 'QUOTA_EXCEEDED' }, 429);
		});

		await expect(searchArtists('anything', 'AU')).rejects.toThrow(QUOTA_EXCEEDED_MESSAGE);
		expect(calls.filter((call) => call.url !== TOKEN_URL)).toHaveLength(1);
	});

	it('retries a plain 429 after Retry-After, then succeeds', async () => {
		let searchAttempts = 0;
		recordFetch((url) => {
			if (url.toString() === TOKEN_URL) return tokenResponse();
			searchAttempts++;
			if (searchAttempts === 1) return json({}, 429, { 'Retry-After': '0' });
			return json({ artists: { items: [{ id: 'a1', name: 'Found' }] } });
		});

		const artists = await searchArtists('retry', 'AU');
		expect(artists).toEqual([
			{ id: 'a1', name: 'Found', image: { url: '/images/default-artist-image.png', width: 0, height: 0 } },
		]);
		expect(searchAttempts).toBe(2);
	});
});

describe('getPlaylistArtists', () => {
	it('dedupes artists, counts track appearances, skips null/local/ID-less entries, and parses both item and track keys', async () => {
		const calls = recordFetch((url) => {
			if (url.toString() === TOKEN_URL) return tokenResponse();
			if (url.pathname === `/v1/playlists/${PLAYLIST_ID}`) {
				return json({ name: 'Road Trip', owner: { display_name: 'Penny' }, tracks: { total: 5 } });
			}
			if (url.pathname === `/v1/playlists/${PLAYLIST_ID}/items`) {
				return json({
					total: 5,
					items: [
						//New-shape entry
						{
							item: {
								artists: [
									{ id: 'artist-a', name: 'Alpha' },
									{ id: 'artist-b', name: 'Beta' },
								],
								album: { images: [{ url: 'https://img/a-300.jpg', width: 300, height: 300 }] },
							},
						},
						//Old-shape entry (the `track` key, still present in
						//Spotify's transition period)
						{
							track: {
								artists: [{ id: 'artist-a', name: 'Alpha' }],
								album: { images: [{ url: 'https://img/a-300.jpg', width: 300, height: 300 }] },
							},
						},
						//Removed/unavailable track: the entry is null
						null,
						//Local file: artists have no real IDs
						{ item: { is_local: true, artists: [{ name: 'Local File Artist' }], album: {} } },
						//An artist without an ID
						{ item: { artists: [{ name: 'No ID' }], album: {} } },
					],
				});
			}
			return json({ error: { message: `unexpected URL ${url.toString()}` } }, 500);
		});

		const result = await getPlaylistArtists(`https://open.spotify.com/playlist/${PLAYLIST_ID}?si=shared`);

		expect(result.playlistName).toBe('Road Trip');
		expect(result.tracksTotal).toBe(5);
		//Alpha featured on 2 tracks, Beta on 1; most featured first
		expect(result.artists).toEqual([
			{
				id: 'artist-a',
				name: 'Alpha',
				image: { url: 'https://img/a-300.jpg', width: 300, height: 300 },
				trackCount: 2,
			},
			{
				id: 'artist-b',
				name: 'Beta',
				image: { url: 'https://img/a-300.jpg', width: 300, height: 300 },
				trackCount: 1,
			},
		]);

		//Metadata + one page of contents, both with the app token
		const apiCalls = calls.filter((call) => call.url !== TOKEN_URL);
		expect(apiCalls).toHaveLength(2);
		expect(apiCalls.map((call) => authHeader(call.init))).toEqual([`Bearer ${APP_TOKEN}`, `Bearer ${APP_TOKEN}`]);
	});

	it('paginates (100 per page) and stops at the 1,000-track cap', async () => {
		const total = 2500; //Would be 25 pages: we must stop after 10
		const calls = recordFetch((url) => {
			if (url.toString() === TOKEN_URL) return tokenResponse();
			if (url.pathname === `/v1/playlists/${PLAYLIST_ID}`) {
				return json({ name: 'Huge', tracks: { total } });
			}
			if (url.pathname === `/v1/playlists/${PLAYLIST_ID}/items`) {
				const offset = Number(url.searchParams.get('offset'));
				const remaining = Math.min(100, total - offset);
				const items = Array.from({ length: remaining }, (_, i) => ({
					item: {
						artists: [{ id: `artist-${(offset + i) % 40}`, name: `Artist ${(offset + i) % 40}` }],
						album: { images: [] },
					},
				}));
				return json({ total, items });
			}
			return json({ error: { message: `unexpected URL ${url.toString()}` } }, 500);
		});

		const result = await getPlaylistArtists(PLAYLIST_ID);

		const itemsCalls = calls.filter((call) => call.url.includes('/items'));
		expect(itemsCalls).toHaveLength(10);
		expect(itemsCalls.map((call) => new URL(call.url).searchParams.get('offset'))).toEqual(
			Array.from({ length: 10 }, (_, i) => String(i * 100)),
		);
		//40 artists round-robin over 1,000 read tracks: 25 each
		expect(result.artists).toHaveLength(40);
		expect(result.artists[0]?.trackCount).toBe(25);
		expect(result.tracksTotal).toBe(2500);
	});

	it('rejects inputs that are not playlist links before calling Spotify', async () => {
		const calls = recordFetch(() => tokenResponse());

		await expect(getPlaylistArtists(`https://open.spotify.com/track/${PLAYLIST_ID}`)).rejects.toThrow(
			"That doesn't look like a Spotify playlist link.",
		);
		expect(calls.filter((call) => call.url !== TOKEN_URL)).toHaveLength(0);
	});

	it("maps a 404 to the not-found message (private and Spotify's own playlists)", async () => {
		recordFetch((url) => {
			if (url.toString() === TOKEN_URL) return tokenResponse();
			return json({ error: { message: 'Resource not found' } }, 404);
		});

		await expect(getPlaylistArtists(`spotify:playlist:${PLAYLIST_ID}`)).rejects.toThrow(
			"Playlist not found. Check the link - and note that private playlists and Spotify's own playlists (like Today's Top Hits or Discover Weekly) can't be imported.",
		);
	});

	it('reports an empty playlist', async () => {
		recordFetch((url) => {
			if (url.toString() === TOKEN_URL) return tokenResponse();
			if (url.pathname === `/v1/playlists/${PLAYLIST_ID}`) return json({ name: 'Empty', tracks: { total: 0 } });
			return json({ total: 0, items: [] });
		});

		await expect(getPlaylistArtists(PLAYLIST_ID)).rejects.toThrow('That playlist is empty.');
	});

	it("reports contents Spotify doesn't return (the eventual owner-only restriction)", async () => {
		recordFetch((url) => {
			if (url.toString() === TOKEN_URL) return tokenResponse();
			if (url.pathname === `/v1/playlists/${PLAYLIST_ID}`) return json({ name: 'Locked', tracks: { total: 40 } });
			return json({ total: 40, items: [] });
		});

		await expect(getPlaylistArtists(PLAYLIST_ID)).rejects.toThrow(
			"Spotify didn't return the contents of that playlist. It may be private, or Spotify may no longer allow reading other people's playlists - try searching for the artists instead.",
		);
	});
});
