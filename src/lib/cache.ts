/**
 * Tiny per-isolate TTL cache, used to cut repeat Spotify calls (which spend the
 * app's shared developer-account quota). Worker isolates are long-lived, so
 * this pays off within an isolate; it deliberately doesn't try to share state
 * across isolates. Eviction past maxSize is oldest-first (Map insertion order,
 * refreshed on get, so it's LRU-ish).
 */
export class TtlCache<T> {
	private readonly entries = new Map<string, { value: T; expiresAt: number }>();

	constructor(
		private readonly ttlMs: number,
		private readonly maxSize = 100,
	) {}

	get(key: string): T | undefined {
		const entry = this.entries.get(key);
		if (!entry) return undefined;

		if (entry.expiresAt <= Date.now()) {
			this.entries.delete(key);
			return undefined;
		}

		//Refresh insertion order so eviction stays LRU-ish
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.value;
	}

	set(key: string, value: T): void {
		this.entries.delete(key);
		this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });

		while (this.entries.size > this.maxSize) {
			const oldest = this.entries.keys().next();
			if (oldest.done) break;
			this.entries.delete(oldest.value);
		}
	}
}
