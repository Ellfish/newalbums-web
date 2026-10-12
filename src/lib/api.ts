/** Helpers for the JSON API responses, replacing the old ApiResponse envelope */

export function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export function errorResponse(message: string, status = 500): Response {
	return jsonResponse({ error: message }, status);
}

export async function readJsonBody<T>(request: Request): Promise<T | null> {
	try {
		return (await request.json()) as T;
	} catch {
		return null;
	}
}

/**
 * The Spotify-proxy endpoints spend the app's own Spotify quota, so they only
 * accept same-origin requests. Browser fetch() always sends an Origin header
 * for POSTs, so a missing Origin is treated as foreign too.
 */
export function isSameOrigin(request: Request): boolean {
	const origin = request.headers.get('Origin');
	if (!origin) return false;

	try {
		return new URL(origin).origin === new URL(request.url).origin;
	} catch {
		return false;
	}
}
