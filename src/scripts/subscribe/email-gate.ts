import {
	STEP_1_HEADING,
	getContentElement,
	postJson,
	setStatus,
	setStepHeading,
	type MagicLinkSentResponse,
} from "./shared";

/**
 * Step 1 of the flow: the email gate. The visitor enters their email address,
 * we send a magic link, and the screen switches to "check your inbox" until
 * they click the emailed link (which re-enters the flow via
 * /subscribe-to-artists?token=..., handled by main.ts).
 */

export function renderEmailGate(message: string | null): void {
	setStepHeading(STEP_1_HEADING);

	const content = getContentElement();
	content.innerHTML = `
		<p class="m-b-40">
			Enter your email address and we'll send you a sign-in link that verifies your email
			and keeps you signed in for 24 hours – no password or Spotify login needed.
		</p>

		<div class="form-group">
			<label class="control-label" for="email">Your email address</label>
			<input type="email" id="email" class="form-control narrow-input" placeholder="name@example.com"
				spellcheck="false" autocomplete="off" />
		</div>
		<button type="button" class="btn btn-primary btn-lg" id="send-link">Email me a sign-in link</button>
		<div id="link-status" class="import-status m-t-10" hidden></div>`;

	if (message) {
		setStatus("link-status", message, true);
	}

	const input = document.getElementById("email")! as HTMLInputElement;
	const button = document.getElementById("send-link")! as HTMLButtonElement;
	button.addEventListener("click", () => void requestMagicLink());
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			void requestMagicLink();
		}
	});
	input.focus();
}

async function requestMagicLink(): Promise<void> {
	const input = document.getElementById("email")! as HTMLInputElement;
	const button = document.getElementById("send-link")! as HTMLButtonElement;
	const email = input.value.trim();

	if (!email) {
		setStatus("link-status", "Please enter your email address.", true);
		return;
	}

	button.disabled = true;
	setStatus("link-status", "Sending your sign-in link…", false);

	try {
		const data = await postJson<MagicLinkSentResponse>("/api/auth/request-magic-link", {
			emailAddress: email,
		});
		renderCheckYourInbox(data.statusMessage);
	} catch (e) {
		setStatus("link-status", e instanceof Error ? e.message : String(e), true);
		button.disabled = false;
	}
}

function renderCheckYourInbox(statusMessage: string): void {
	//Still step 1 until the emailed link brings them back with a token
	setStepHeading(STEP_1_HEADING);

	const content = getContentElement();
	content.innerHTML = `
		<p id="inbox-message" class="m-b-20"></p>
		<p class="m-b-20">
			Click the link in the email to continue – it also verifies your email address, so you won't
			need to do anything else.
		</p>
		<a href="#" id="back-to-email">Use a different email address</a>`;

	document.getElementById("inbox-message")!.textContent = statusMessage;
	document
		.getElementById("back-to-email")!
		.addEventListener("click", (event) => {
			event.preventDefault();
			renderEmailGate(null);
		});
}
