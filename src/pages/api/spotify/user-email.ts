import type { APIRoute } from 'astro';
import { readJsonBody, jsonResponse, errorResponse } from '../../../lib/api';
import { getUserEmail } from '../../../lib/spotify';

export const prerender = false;

interface Body {
	accessToken?: string;
}

/** Port of SpotifyController.UserEmail */
export const POST: APIRoute = async ({ request }) => {
	const body = await readJsonBody<Body>(request);
	if (!body?.accessToken) {
		return errorResponse('Please provide a valid Spotify access token.', 400);
	}

	try {
		const email = await getUserEmail(body.accessToken);
		return jsonResponse({ email });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e));
	}
};
