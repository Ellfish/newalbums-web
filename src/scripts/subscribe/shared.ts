/**
 * Shared types, constants and helpers for the subscribe flow's client-side
 * steps (the email gate and the artist picker). These modules only ever run
 * in the browser; server-side code lives in src/lib.
 */

export interface ArtistImage {
	url: string;
	width: number;
	height: number;
}

export interface SpotifyArtistSummary {
	id: string;
	name: string;
	image: ArtistImage;
}

export interface PlaylistImportResult {
	playlistName: string | null;
	tracksTotal: number | null;
	artists: SpotifyArtistSummary[];
}

/** An artist in the picker's selection list */
export interface ArtistState extends SpotifyArtistSummary {
	selected: boolean;
}

export interface SearchResponse {
	artists: SpotifyArtistSummary[];
}

export interface MagicLinkSentResponse {
	statusMessage: string;
}

export interface ValidatedTokenResponse {
	emailAddress: string;
}

export interface SubscribeResult {
	statusMessage: string;
}

export const SEARCH_DEBOUNCE_MS = 400;
export const MIN_SEARCH_LENGTH = 2;
export const TOKEN_STORAGE_KEY = "subscribeAccessToken";

/** The page-level heading text per flow step (the h1 lives in the page markup) */
export const STEP_1_HEADING = "Step 1: your email";
export const STEP_2_HEADING = "Step 2: search for artists";

/**
 * JSON POST that throws an Error carrying the HTTP status, so callers can
 * distinguish an expired token (401) from other errors.
 */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
	if (!response.ok || !data) {
		throw Object.assign(
			new Error(data?.error ?? `Request failed with status ${response.status}`),
			{ status: response.status },
		);
	}
	return data;
}

export function isTokenRejected(e: unknown): boolean {
	return e instanceof Error && (e as Error & { status?: number }).status === 401;
}

/** Status lines are plain text (playlist names etc. come from Spotify) */
export function setStatus(elementId: string, message: string, isError: boolean): void {
	const element = document.getElementById(elementId);
	if (!element) return;
	element.textContent = message;
	element.classList.toggle("error", isError);
	element.hidden = !message;
}

export function plural(
	count: number,
	singular: string,
	pluralForm = `${singular}s`,
): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function getContentElement(): HTMLElement {
	return document.getElementById("subscribe-content")!;
}

/** Sets the page-level step heading (the h1 in the page markup) */
export function setStepHeading(text: string): void {
	const heading = document.getElementById("step-heading");
	if (heading) heading.textContent = text;
}
