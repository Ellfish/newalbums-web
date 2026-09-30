/** Thin helpers over D1, mirroring the query style of the .NET app services */

export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
	const result = await db.prepare(sql).bind(...params).all<T>();
	return result.results ?? [];
}

export async function first<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
	const rows = await all<T>(db, sql, ...params);
	return rows.length > 0 ? rows[0] : null;
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Response> {
	return db.prepare(sql).bind(...params).run();
}

/** SQLite stores booleans as INTEGER, as did EF Core */
export function toBool(value: number): boolean {
	return value === 1;
}
