import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { readJsonBody, jsonResponse, errorResponse, isSameOrigin } from '../../../lib/api';
import { getPlaylistArtistsById, parsePlaylistInput, INVALID_PLAYLIST_INPUT_MESSAGE } from '../../../lib/spotify';
import { getSubscriberByAccessToken, ACCESS_TOKEN_INVALID_MESSAGE } from '../../../lib/repo/access-tokens';
import type { PlaylistArtistsResult } from '../../../lib/spotify';
import { TtlCache } from '../../../lib/cache';

export const prerender = false;

interface Body {
	token?: string;
	playlist?: string;
}

/**
 * Playlist import for the picker page: the unique artists of a public Spotify
 * playlist, extracted with the app's own client-credentials token (never a
 * user's) - but only for visitors holding a valid magic-link access token,
 * i.e. a verified email. Same-origin only and inputs/pages capped, because
 * these calls spend the app's shared Spotify quota; playlist contents change
 * rarely, so results are cached per isolate for an hour.
 */
const playlistCache = new TtlCache<PlaylistArtistsResult>(60 * 60 * 1000);

export const POST: APIRoute = async ({ request }) => {
	if (!isSameOrigin(request)) {
		return errorResponse('This endpoint only accepts same-origin requests.', 403);
	}

	const body = await readJsonBody<Body>(request);

	//The email-first gate: no importing until the visitor has clicked their magic link
	const subscriber = await getSubscriberByAccessToken(env.DB, body?.token ?? '');
	if (!subscriber) {
		return errorResponse(ACCESS_TOKEN_INVALID_MESSAGE, 401);
	}

	const input = (body?.playlist ?? '').trim();

	if (input.length === 0) {
		return errorResponse('Please paste a link to a public Spotify playlist.', 400);
	}
	if (input.length > 2000) {
		return errorResponse('That playlist link is too long.', 400);
	}

	const playlistId = parsePlaylistInput(input);
	if (!playlistId) {
		return errorResponse(INVALID_PLAYLIST_INPUT_MESSAGE, 400);
	}

	const cached = playlistCache.get(playlistId);
	if (cached) {
		return jsonResponse(cached);
	}

	try {
		const result = await getPlaylistArtistsById(playlistId);
		playlistCache.set(playlistId, result);
		return jsonResponse(result);
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e));
	}
};
