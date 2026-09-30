-- Obvious fake test data for local dev + smoke testing (apply with:
--   npx wrangler d1 execute newalbums --local --file db/seed-test.sql)
-- Never apply to the remote databases.
INSERT INTO NaArtists (Id, CreatedDate, Name, SpotifyId) VALUES
	(1, '2026-09-01T00:00:00.000Z', 'Test Artist One', 'testartist1'),
	(2, '2026-09-01T00:00:00.000Z', 'Test Artist Two', 'testartist2');

INSERT INTO NaAlbums (Id, CreatedDate, Name, SpotifyId, ReleaseDate) VALUES
	(1, '2026-09-01T00:00:00.000Z', 'Old Test Album', 'testalbum1', '2026-08-15');

INSERT INTO NaArtistAlbums (ArtistId, AlbumId) VALUES (1, 1);

INSERT INTO NaSubscribers (Id, CreatedDate, EmailAddress, EmailAddressVerified, EmailVerifyCode, UnsubscribeToken) VALUES
	(1, '2026-09-01T00:00:00.000Z', 'unverified@example.com', 0, 'abcdef1234567890', '11111111-1111-1111-1111-111111111111'),
	(2, '2026-09-01T00:00:00.000Z', 'verified@example.com', 1, NULL, '22222222-2222-2222-2222-222222222222');

INSERT INTO NaSubscriptions (Id, CreatedDate, SubscriberId, ArtistId) VALUES
	(1, '2026-09-01T00:00:00.000Z', 2, 1),
	(2, '2026-09-01T00:00:00.000Z', 2, 2);
