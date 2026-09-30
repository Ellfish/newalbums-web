import { env } from 'cloudflare:workers';

/**
 * Protects the admin API (used by the NAS job) with a shared token in the
 * X-Admin-Token header, compared in constant time.
 */
export async function isAdminAuthorized(request: Request): Promise<boolean> {
	const expected = env.ADMIN_TOKEN;
	if (!expected) return false;

	const provided = request.headers.get('x-admin-token');
	if (!provided || provided.length !== expected.length) return false;

	try {
		// workerd extension: constant-time comparison. Not part of the standard
		// SubtleCrypto TS types, but provided by workerd (accepts ArrayBuffer or
		// a TypedArray over one).
		const a = new TextEncoder().encode(provided);
		const b = new TextEncoder().encode(expected);
		const subtleWithTimingSafeEqual = crypto.subtle as SubtleCrypto & {
			timingSafeEqual(
				a: Uint8Array<ArrayBuffer> | ArrayBuffer,
				b: Uint8Array<ArrayBuffer> | ArrayBuffer,
			): boolean;
		};
		return subtleWithTimingSafeEqual.timingSafeEqual(a, b);
	} catch {
		// Fallback for environments without the timingSafeEqual extension
		return provided === expected;
	}
}
