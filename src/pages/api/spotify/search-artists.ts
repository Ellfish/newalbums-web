import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { readJsonBody, jsonResponse, errorResponse, isSameOrigin } from '../../../lib/api';
import { searchArtists, resolveMarket } from '../../../lib/spotify';
import { getSubscriberByAccessToken, ACCESS_TOKEN_INVALID_MESSAGE } from '../../../lib/repo/access-tokens';
import type { SpotifyArtistSummary } from '../../../lib/spotify';
import { TtlCache } from '../../../lib/cache';

export const prerender = false;

interface Body {
	token?: string;
	query?: string;
}

/**
 * Artist search for the picker page, made with the app's own client-credentials
 * token (never a user's) - but only for visitors holding a valid magic-link
 * access token, i.e. a verified email. These calls spend the app's shared
 * Spotify quota, so: same-origin only, token-gated, queries length-capped,
 * and responses cached per isolate (repeated queries are the norm while
 * people type, and results barely change).
 */
const searchCache = new TtlCache<SpotifyArtistSummary[]>(5 * 60 * 1000);

export const POST: APIRoute = async ({ request }) => {
	if (!isSameOrigin(request)) {
		return errorResponse('This endpoint only accepts same-origin requests.', 403);
	}

	const body = await readJsonBody<Body>(request);

	//The email-first gate: no searching until the visitor has clicked their magic link
	const subscriber = await getSubscriberByAccessToken(env.DB, body?.token ?? '');
	if (!subscriber) {
		return errorResponse(ACCESS_TOKEN_INVALID_MESSAGE, 401);
	}

	const query = (body?.query ?? '').trim();

	if (query.length < 2 || query.length > 100) {
		return errorResponse('Please enter a search term of 2 to 100 characters.', 400);
	}

	//The visitor's own country when Cloudflare provides it (IP geolocation on
	//request.cf), else the configured default - it only affects availability filtering
	const cfCountry = (request as Request & { cf?: { country?: string } }).cf?.country;
	const market = resolveMarket(cfCountry, env.SPOTIFY_MARKET || 'AU');

	const cacheKey = `${market}:${query.toLowerCase()}`;
	const cached = searchCache.get(cacheKey);
	if (cached) {
		return jsonResponse({ artists: cached });
	}

	try {
		const artists = await searchArtists(query, market);
		searchCache.set(cacheKey, artists);
		return jsonResponse({ artists });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e));
	}
};
