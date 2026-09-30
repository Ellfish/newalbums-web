import { env } from 'cloudflare:workers';
import schemaSql from '../db/schema.sql?raw';

export function getDb(): D1Database {
	return env.DB;
}

export async function applySchema(): Promise<void> {
	const db = getDb();
	// D1's exec() rejects comment-only lines, so strip full-line comments and
	// run the statements as a batch instead
	const statements = schemaSql
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('--'))
		.join('\n')
		.split(';')
		.map((statement) => statement.trim())
		.filter((statement) => statement.length > 0);

	await db.batch(statements.map((statement) => db.prepare(statement)));
}

/** Empties all tables (order: children before parents). Each test seeds its own data. */
export async function resetDb(): Promise<void> {
	const db = getDb();
	await db.batch([
		db.prepare('DELETE FROM NaSubscriptions'),
		db.prepare('DELETE FROM NaSubscribers'),
		db.prepare('DELETE FROM NaArtistAlbums'),
		db.prepare('DELETE FROM NaAlbums'),
		db.prepare('DELETE FROM NaArtists'),
	]);
}
