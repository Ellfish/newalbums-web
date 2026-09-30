import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { readJsonBody, jsonResponse, errorResponse } from '../../../../../lib/api';
import { isAdminAuthorized } from '../../../../../lib/admin-auth';
import { createAlbums } from '../../../../../lib/repo/albums';

export const prerender = false;

interface Body {
	albums?: { spotifyId?: string; name?: string; releaseDate?: string }[];
}

/**
 * Port of AlbumAppService.CreateAlbums, for the NAS job to record albums it
 * has notified about. Idempotent: existing albums are left alone, and the
 * artist is linked to them if the link is missing.
 */
export const POST: APIRoute = async ({ request, params }) => {
	if (!(await isAdminAuthorized(request))) {
		return errorResponse('Unauthorized', 401);
	}

	const artistId = Number(params.artistId);
	if (!Number.isInteger(artistId) || artistId <= 0) {
		return errorResponse('Please provide a valid ArtistId.', 400);
	}

	const body = await readJsonBody<Body>(request);
	const albums = (body?.albums ?? []).filter(
		(album): album is { spotifyId: string; name: string; releaseDate: string } =>
			typeof album.spotifyId === 'string' &&
			album.spotifyId.length > 0 &&
			typeof album.name === 'string' &&
			typeof album.releaseDate === 'string',
	);

	try {
		await createAlbums(env.DB, artistId, albums);
		return jsonResponse({ success: true });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e));
	}
};
