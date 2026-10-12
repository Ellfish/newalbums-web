import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { readJsonBody, jsonResponse, errorResponse } from '../../../lib/api';
import { getOrCreateArtists } from '../../../lib/repo/artists';
import { subscribeToArtists, getSubscribeStatusMessage } from '../../../lib/repo/subscriptions';
import { getSubscriberByAccessToken, ACCESS_TOKEN_INVALID_MESSAGE } from '../../../lib/repo/access-tokens';

export const prerender = false;

interface Body {
	token?: string;
	artists?: { spotifyId?: string; name?: string }[];
}

/**
 * Port of SubscriptionController.SubscribeToArtists, reworked for the
 * email-first flow: the subscriber is resolved from the magic-link access
 * token (never from client input), which also means their email was already
 * verified by the link click - there's no separate verification step. Then:
 * get-or-create the artists, subscribe with the per-subscriber cap.
 */
export const POST: APIRoute = async ({ request }) => {
	const body = await readJsonBody<Body>(request);

	const subscriber = await getSubscriberByAccessToken(env.DB, body?.token ?? '');
	if (!subscriber) {
		return errorResponse(ACCESS_TOKEN_INVALID_MESSAGE, 401);
	}

	const artists = (body?.artists ?? []).filter(
		(artist): artist is { spotifyId: string; name: string } =>
			typeof artist.spotifyId === 'string' && artist.spotifyId.length > 0 && typeof artist.name === 'string',
	);

	if (artists.length === 0) {
		return errorResponse('Please select at least one artist to subscribe to.', 400);
	}

	try {
		const artistRows = await getOrCreateArtists(
			env.DB,
			artists.map((artist) => ({ spotifyId: artist.spotifyId, name: artist.name })),
		);

		const { existingSubscriptionsCount, newSubscriptionsCount, limitReached } = await subscribeToArtists(
			env.DB,
			subscriber.Id,
			artistRows.map((artist) => artist.Id),
		);

		//Ported from SubscribeToArtistsOutput.SetStatusMessage
		const statusMessage = getSubscribeStatusMessage(existingSubscriptionsCount, newSubscriptionsCount, limitReached);

		return jsonResponse({
			statusMessage,
			requiresEmailVerification: subscriber.EmailAddressVerified !== 1,
		});
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e));
	}
};
