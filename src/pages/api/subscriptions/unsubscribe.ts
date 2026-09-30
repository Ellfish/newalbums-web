import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { readJsonBody, jsonResponse, errorResponse } from '../../../lib/api';
import {
	unsubscribeFromArtist,
	unsubscribeFromAll,
	SUBSCRIPTION_NOT_FOUND_ERROR,
} from '../../../lib/repo/subscriptions';

export const prerender = false;

interface Body {
	unsubscribeToken?: string;
	artistId?: number;
}

/** Port of SubscriptionController.Unsubscribe (per-artist or all) */
export const POST: APIRoute = async ({ request }) => {
	const body = await readJsonBody<Body>(request);

	if (!body?.unsubscribeToken) {
		return errorResponse('Please ensure you click one of the unsubscribe links from an email.', 400);
	}

	if (body.artistId !== undefined && (!Number.isInteger(body.artistId) || body.artistId <= 0)) {
		return errorResponse('Please provide a valid ArtistId.', 400);
	}

	try {
		const success =
			body.artistId !== undefined
				? await unsubscribeFromArtist(env.DB, body.unsubscribeToken, body.artistId)
				: await unsubscribeFromAll(env.DB, body.unsubscribeToken);

		if (!success) {
			return errorResponse(SUBSCRIPTION_NOT_FOUND_ERROR, 400);
		}

		return jsonResponse({ success: true });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e));
	}
};
