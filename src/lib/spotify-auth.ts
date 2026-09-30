/**
 * Client-side Spotify Authorization Code + PKCE flow.
 *
 * Spotify removed the implicit grant (response_type=token) - the old flow now
 * returns "response_type must be code". PKCE is the replacement for browser
 * apps: no client secret is involved, and the token endpoint allows CORS, so
 * the whole flow stays client-side (matching the old architecture where only
 * the resulting access token ever reached our API).
 */

export const SPOTIFY_CLIENT_ID = 'b61565f287d0410f9e2f13fc71140fcc';
export const SPOTIFY_SCOPES = 'user-follow-read user-top-read user-read-email';
//Always show the Spotify auth dialog, even if already authenticated (as the old app did)
export const SPOTIFY_SHOW_DIALOG = true;

const VERIFIER_STORAGE_KEY = 'spotifyCodeVerifier';
const STATE_STORAGE_KEY = 'spotifyAuthState';
const TOKEN_STORAGE_KEY = 'spotifyAccessToken';

function base64url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');
}

export function getRedirectUri(): string {
	return `${window.location.origin}/spotify-callback/`;
}

/**
 * Generates and stores the PKCE verifier + state, and returns the authorize
 * URL. Called at page load, like the old flow, so Get Started just navigates.
 */
export async function getSpotifyAuthoriseUrl(): Promise<string> {
	// 64 random bytes -> 86 unreserved characters (43-128 is the RFC 7636 range)
	const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
	const challenge = base64url(
		new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
	);
	const state = base64url(crypto.getRandomValues(new Uint8Array(16)));

	sessionStorage.setItem(VERIFIER_STORAGE_KEY, verifier);
	sessionStorage.setItem(STATE_STORAGE_KEY, state);

	const redirectUrl = encodeURIComponent(getRedirectUri());
	return (
		`https://accounts.spotify.com/authorize?client_id=${SPOTIFY_CLIENT_ID}` +
		`&response_type=code&redirect_uri=${redirectUrl}` +
		`&scope=${encodeURIComponent(SPOTIFY_SCOPES)}` +
		`&show_dialog=${SPOTIFY_SHOW_DIALOG}` +
		`&state=${state}&code_challenge_method=S256&code_challenge=${challenge}`
	);
}

interface SpotifyTokenResponse {
	access_token?: string;
	error?: string;
	error_description?: string;
}

/**
 * Exchanges the authorization code (query param on the callback URL) for an
 * access token, validating the state to protect against CSRF. Returns the
 * access token, or throws with a user-displayable message.
 */
export async function exchangeCodeForToken(searchParams: URLSearchParams): Promise<string> {
	const code = searchParams.get('code');
	const state = searchParams.get('state');
	const verifier = sessionStorage.getItem(VERIFIER_STORAGE_KEY);
	const expectedState = sessionStorage.getItem(STATE_STORAGE_KEY);

	if (!code || !verifier || !state || !expectedState || state !== expectedState) {
		throw new Error('Invalid Spotify callback URL (missing code, or missing/mismatched state).');
	}

	const response = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		// form-encoded body: a "simple" CORS request, no preflight required
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: SPOTIFY_CLIENT_ID,
			grant_type: 'authorization_code',
			code,
			redirect_uri: getRedirectUri(),
			code_verifier: verifier,
		}),
	});

	const body = (await response.json().catch(() => null)) as SpotifyTokenResponse | null;

	if (!response.ok || !body?.access_token) {
		throw new Error(
			body?.error_description ?? body?.error ?? `Spotify token request failed (${response.status})`,
		);
	}

	//Clean up the one-time auth artifacts
	sessionStorage.removeItem(VERIFIER_STORAGE_KEY);
	sessionStorage.removeItem(STATE_STORAGE_KEY);

	return body.access_token;
}

export function storeAccessToken(token: string): void {
	sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function getAccessToken(): string | null {
	return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function clearAccessToken(): void {
	sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}
