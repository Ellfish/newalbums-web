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
