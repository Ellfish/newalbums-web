import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonResponse, errorResponse } from '../../../lib/api';
import { isAdminAuthorized } from '../../../lib/admin-auth';
import { countArtists } from '../../../lib/repo/artists';
import { countAlbums } from '../../../lib/repo/albums';
import { countSubscribers } from '../../../lib/repo/subscribers';
import { countSubscriptions } from '../../../lib/repo/subscriptions';

export const prerender = false;

/** Health check / smoke test for the NAS job: verifies auth + DB + row counts */
export const GET: APIRoute = async ({ request }) => {
	if (!(await isAdminAuthorized(request))) {
		return errorResponse('Unauthorized', 401);
	}

	try {
		const [artists, albums, subscribers, subscriptions] = await Promise.all([
			countArtists(env.DB),
			countAlbums(env.DB),
			countSubscribers(env.DB),
			countSubscriptions(env.DB),
		]);

		return jsonResponse({ ok: true, artists, albums, subscribers, subscriptions });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e));
	}
};
