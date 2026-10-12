-- D1 schema for fresh/staging databases.
-- Mirrors the EF Core / SQLite schema used by the NAS app (same table and
-- column names) so the NAS SQLite dump imports 1:1 at cutover. The dump brings
-- its own CREATE TABLE statements, so this file is only applied to databases
-- that start empty (local dev, staging).
CREATE TABLE IF NOT EXISTS NaArtists (
	Id INTEGER PRIMARY KEY,
	CreatedDate TEXT NOT NULL,
	Name TEXT NOT NULL,
	SpotifyId TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS IX_NaArtists_SpotifyId ON NaArtists (SpotifyId);

CREATE TABLE IF NOT EXISTS NaAlbums (
	Id INTEGER PRIMARY KEY,
	CreatedDate TEXT NOT NULL,
	Name TEXT NOT NULL,
	SpotifyId TEXT NOT NULL,
	ReleaseDate TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS IX_NaAlbums_SpotifyId ON NaAlbums (SpotifyId);

CREATE TABLE IF NOT EXISTS NaArtistAlbums (
	ArtistId INTEGER NOT NULL,
	AlbumId INTEGER NOT NULL,
	PRIMARY KEY (ArtistId, AlbumId)
);

CREATE TABLE IF NOT EXISTS NaSubscribers (
	Id INTEGER PRIMARY KEY,
	CreatedDate TEXT NOT NULL,
	EmailAddress TEXT NOT NULL,
	EmailAddressVerified INTEGER NOT NULL,
	EmailVerifyCode TEXT,
	UnsubscribeToken TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS IX_NaSubscribers_EmailAddress ON NaSubscribers (EmailAddress);
CREATE INDEX IF NOT EXISTS IX_NaSubscribers_UnsubscribeToken ON NaSubscribers (UnsubscribeToken);

CREATE TABLE IF NOT EXISTS NaSubscriptions (
	Id INTEGER PRIMARY KEY,
	CreatedDate TEXT NOT NULL,
	SubscriberId INTEGER NOT NULL,
	ArtistId INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS IX_NaSubscriptions_SubscriberId ON NaSubscriptions (SubscriberId);
CREATE INDEX IF NOT EXISTS IX_NaSubscriptions_ArtistId ON NaSubscriptions (ArtistId);

-- Web-app-only (NOT part of the NAS-mirrored schema): the 24h access tokens
-- carried by the magic-link sign-in emails. CREATE TABLE IF NOT EXISTS makes
-- applying this file to an existing (remote) database an idempotent migration.
CREATE TABLE IF NOT EXISTS NaAccessTokens (
	Id INTEGER PRIMARY KEY,
	CreatedDate TEXT NOT NULL,
	SubscriberId INTEGER NOT NULL,
	Token TEXT NOT NULL,
	ExpiresDate TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS IX_NaAccessTokens_Token ON NaAccessTokens (Token);
