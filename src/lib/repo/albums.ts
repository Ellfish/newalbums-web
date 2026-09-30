import { first, run } from '../db';

export interface AlbumInput {
	spotifyId: string;
	name: string;
	releaseDate: string;
}

/**
 * Ported from AlbumAppService.CreateAlbums: when we notify a subscriber about
 * an album we store it so we know we've handled it and don't send more
 * notifications for it in future. Idempotent - safe to re-run the daily job.
 */
export async function createAlbums(db: D1Database, artistId: number, albums: AlbumInput[]): Promise<void> {
	for (const album of albums) {
		//If the album is attributed to more than one artist, there's a chance the album already exists
		const existing = await first<{ Id: number }>(db, 'SELECT Id FROM NaAlbums WHERE SpotifyId = ?', album.spotifyId);

		if (existing) {
			//Check if we need to add this artist to the list of artists for the album
			const link = await first<{ ArtistId: number }>(
				db,
				'SELECT ArtistId FROM NaArtistAlbums WHERE ArtistId = ? AND AlbumId = ?',
				artistId,
				existing.Id,
			);

			if (!link) {
				await run(
					db,
					'INSERT INTO NaArtistAlbums (ArtistId, AlbumId) VALUES (?, ?)',
					artistId,
					existing.Id,
				);
			}
		} else {
			const createdDate = new Date().toISOString();
			const insert = await run(
				db,
				'INSERT INTO NaAlbums (CreatedDate, Name, SpotifyId, ReleaseDate) VALUES (?, ?, ?, ?)',
				createdDate,
				album.name,
				album.spotifyId,
				album.releaseDate,
			);
			await run(
				db,
				'INSERT INTO NaArtistAlbums (ArtistId, AlbumId) VALUES (?, ?)',
				artistId,
				insert.meta.last_row_id,
			);
		}
	}
}

export async function countAlbums(db: D1Database): Promise<number> {
	const row = await first<{ Count: number }>(db, 'SELECT COUNT(*) AS Count FROM NaAlbums');
	return row?.Count ?? 0;
}
