import type { APIRoute } from 'astro';
import { readJsonBody, jsonResponse, errorResponse } from '../../../lib/api';
import { getFollowedArtists } from '../../../lib/spotify';

export const prerender = false;

interface Body {
	accessToken?: string;
}

/**
 * Port of SpotifyController.FollowedArtists: returns the user's followed
 * artists with their top artists preselected.
 */
export const POST: APIRoute = async ({ request }) => {
	const body = await readJsonBody<Body>(request);
	if (!body?.accessToken) {
		return errorResponse('Please provide a valid Spotify access token.', 400);
	}

	try {
		const artists = await getFollowedArtists(body.accessToken);
		return jsonResponse({ artists });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e));
	}
};
