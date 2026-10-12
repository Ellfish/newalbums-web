import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { readJsonBody, jsonResponse, errorResponse, isSameOrigin } from '../../../lib/api';
import { getSubscriberByAccessToken, ACCESS_TOKEN_INVALID_MESSAGE } from '../../../lib/repo/access-tokens';
import { setEmailVerified } from '../../../lib/repo/subscribers';

export const prerender = false;

interface Body {
	token?: string;
}

/**
 * Step 2 of the flow, i.e. the magic-link click: validates the 24h access
 * token and marks the email verified - the link IS the verification, so there
 * is no separate verify-email step anymore.
 */
export const POST: APIRoute = async ({ request }) => {
	if (!isSameOrigin(request)) {
		return errorResponse('This endpoint only accepts same-origin requests.', 403);
	}

	const body = await readJsonBody<Body>(request);
	const token = body?.token ?? '';
	if (!token) {
		return errorResponse(ACCESS_TOKEN_INVALID_MESSAGE, 401);
	}

	try {
		const subscriber = await getSubscriberByAccessToken(env.DB, token);
		if (!subscriber) {
			return errorResponse(ACCESS_TOKEN_INVALID_MESSAGE, 401);
		}

		//Possessing the link proves the address is theirs (idempotent: repeat clicks are fine)
		await setEmailVerified(env.DB, subscriber.Id);

		return jsonResponse({ emailAddress: subscriber.EmailAddress });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e));
	}
};
