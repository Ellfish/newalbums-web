import { TOKEN_STORAGE_KEY, postJson, type ValidatedTokenResponse } from "./shared";
import { renderEmailGate } from "./email-gate";
import { renderPicker } from "./picker";

/**
 * Orchestrator for the subscribe flow, and step 2 (the magic-link click):
 * - No token anywhere -> step 1, the email gate
 * - A token in the URL (the emailed link) or this tab's session -> validate
 *   it (which also verifies the email server-side), then step 3, the picker
 */

export function initSubscribeFlow(): void {
	void init();
}

async function init(): Promise<void> {
	//A token in the URL is the magic-link click: consume it, then strip it
	//from the address bar (it's a credential)
	const urlToken = new URLSearchParams(window.location.search).get("token");
	if (urlToken) {
		window.history.replaceState({}, "", window.location.pathname);
		await tryUnlock(urlToken);
		return;
	}

	const storedToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);
	if (storedToken) {
		await tryUnlock(storedToken);
		return;
	}

	renderEmailGate(null);
}

async function tryUnlock(token: string): Promise<void> {
	try {
		const data = await postJson<ValidatedTokenResponse>("/api/auth/validate", { token });
		sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
		renderPicker({
			token,
			emailAddress: data.emailAddress,
			onTokenExpired: handleExpiredToken,
			onSignOut: signOut,
		});
	} catch {
		sessionStorage.removeItem(TOKEN_STORAGE_KEY);
		renderEmailGate(
			"Your sign-in link has expired or is invalid. Enter your email address to get a new one.",
		);
	}
}

/** Any 401 means the token expired mid-session: back to the gate (the picker keeps its selections) */
function handleExpiredToken(): void {
	sessionStorage.removeItem(TOKEN_STORAGE_KEY);
	renderEmailGate("Your sign-in link has expired. Enter your email address to get a new one.");
}

function signOut(): void {
	sessionStorage.removeItem(TOKEN_STORAGE_KEY);
	renderEmailGate(null);
}
