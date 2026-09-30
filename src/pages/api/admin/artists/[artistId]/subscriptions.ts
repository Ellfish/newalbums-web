import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonResponse, errorResponse } from '../../../../../lib/api';
import { isAdminAuthorized } from '../../../../../lib/admin-auth';
import { getSubscriptionsForArtist } from '../../../../../lib/repo/subscriptions';

export const prerender = false;

/**
 * Enriched port of SubscriptionAppService.GetSubscriptionsForArtist, for the
 * NAS job's NotifySubscribers: returns subscriber email, verified flag and
 * unsubscribe token inline (the .NET version did N+1 subscriber lookups).
 */
export const GET: APIRoute = async ({ request, params }) => {
	if (!(await isAdminAuthorized(request))) {
		return errorResponse('Unauthorized', 401);
	}

	const artistId = Number(params.artistId);
	if (!Number.isInteger(artistId) || artistId <= 0) {
		return errorResponse('Please provide a valid ArtistId.', 400);
	}

	try {
		const subscriptions = await getSubscriptionsForArtist(env.DB, artistId);
		return jsonResponse({ subscriptions });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e));
	}
};
