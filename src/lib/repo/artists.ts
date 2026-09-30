import { all, first, run } from '../db';

/** Mirrors the Artist entity / NaArtists table */
export interface ArtistRow {
	Id: number;
	CreatedDate: string;
	Name: string;
	SpotifyId: string;
}

export interface SpotifyArtistInput {
	spotifyId: string;
	name: string;
}

/**
 * Ported from ArtistAppService.GetOrCreateMany: when a user subscribes they
 * will usually subscribe to many artists in one go; some may already exist
 * (if another user has already subscribed to them).
 */
export async function getOrCreateArtists(db: D1Database, artists: SpotifyArtistInput[]): Promise<ArtistRow[]> {
	const result: ArtistRow[] = [];

	for (const artist of artists) {
		let existing = await first<ArtistRow>(db, 'SELECT * FROM NaArtists WHERE SpotifyId = ?', artist.spotifyId);

		if (!existing) {
			const createdDate = new Date().toISOString();
			const insert = await run(
				db,
				'INSERT INTO NaArtists (CreatedDate, Name, SpotifyId) VALUES (?, ?, ?)',
				createdDate,
				artist.name,
				artist.spotifyId,
			);
			existing = {
				Id: insert.meta.last_row_id,
				CreatedDate: createdDate,
				Name: artist.name,
				SpotifyId: artist.spotifyId,
			};
		}

		result.push(existing);
	}

	return result;
}

export interface AdminArtist {
	id: number;
	spotifyId: string;
	name: string;
	albums: { spotifyId: string; name: string; releaseDate: string }[];
}

/**
 * Ported from ArtistAppService.GetAll(IncludeAlbums: true), flattened into one
 * query + grouped in JS. Used by the NAS job to diff new album releases.
 */
export async function getAllArtistsWithAlbums(db: D1Database): Promise<AdminArtist[]> {
	const rows = await all<{
		ArtistId: number;
		ArtistSpotifyId: string;
		ArtistName: string;
		AlbumId: number | null;
		AlbumSpotifyId: string | null;
		AlbumName: string | null;
		AlbumReleaseDate: string | null;
	}>(
		db,
		`SELECT a.Id AS ArtistId, a.SpotifyId AS ArtistSpotifyId, a.Name AS ArtistName,
			al.Id AS AlbumId, al.SpotifyId AS AlbumSpotifyId, al.Name AS AlbumName, al.ReleaseDate AS AlbumReleaseDate
		FROM NaArtists a
		LEFT JOIN NaArtistAlbums aa ON aa.ArtistId = a.Id
		LEFT JOIN NaAlbums al ON al.Id = aa.AlbumId
		ORDER BY a.Id, al.Id`,
	);

	const byId = new Map<number, AdminArtist>();
	for (const row of rows) {
		let artist = byId.get(row.ArtistId);
		if (!artist) {
			artist = { id: row.ArtistId, spotifyId: row.ArtistSpotifyId, name: row.ArtistName, albums: [] };
			byId.set(row.ArtistId, artist);
		}
		if (row.AlbumId !== null && row.AlbumSpotifyId !== null && row.AlbumName !== null) {
			artist.albums.push({
				spotifyId: row.AlbumSpotifyId,
				name: row.AlbumName,
				releaseDate: row.AlbumReleaseDate ?? '',
			});
		}
	}

	return [...byId.values()];
}

export async function countArtists(db: D1Database): Promise<number> {
	const row = await first<{ Count: number }>(db, 'SELECT COUNT(*) AS Count FROM NaArtists');
	return row?.Count ?? 0;
}
