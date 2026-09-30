import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonResponse, errorResponse } from '../../../lib/api';
import { isAdminAuthorized } from '../../../lib/admin-auth';
import { getAllArtistsWithAlbums } from '../../../lib/repo/artists';

export const prerender = false;

/**
 * Port of ArtistAppService.GetAll(IncludeAlbums: true), for the NAS job's
 * daily diff. Returns every artist with all their albums; the job's
 * ReleaseDateNormalised/dedupe logic runs client-side, unchanged.
 */
export const GET: APIRoute = async ({ request }) => {
	if (!(await isAdminAuthorized(request))) {
		return errorResponse('Unauthorized', 401);
	}

	try {
		const artists = await getAllArtistsWithAlbums(env.DB);
		return jsonResponse({ artists });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e));
	}
};
