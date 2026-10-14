import {
	MIN_SEARCH_LENGTH,
	SEARCH_DEBOUNCE_MS,
	STEP_2_HEADING,
	getContentElement,
	isTokenRejected,
	plural,
	postJson,
	setStatus,
	setStepHeading,
	type ArtistState,
	type PlaylistImportResult,
	type SearchResponse,
	type SpotifyArtistSummary,
	type SubscribeResult,
} from "./shared";

/**
 * Step 3 of the flow: the artist picker, unlocked by a valid magic-link
 * token. Artists are found by importing a public playlist and/or searching,
 * selected in the grid, then subscribed. The artists Map is module state, so
 * it survives re-renders: a token expiring mid-session returns to the email
 * gate without losing selections.
 */

/** Everything the picker needs from the rest of the flow, injected by main.ts */
export interface PickerContext {
	token: string;
	emailAddress: string;
	/** Any API call rejecting the token (401): back to the email gate */
	onTokenExpired: () => void;
	/** "Not you?" - sign out back to the gate */
	onSignOut: () => void;
}

//Insertion-ordered by artist ID: playlist imports land first (most
//frequently featured first), search adds are appended
const artists = new Map<string, ArtistState>();

let pickerContext: PickerContext | null = null;
let searchSequence = 0;
let lastSearchResults: SpotifyArtistSummary[] = [];

export function renderPicker(context: PickerContext): void {
	pickerContext = context;
	setStepHeading(STEP_2_HEADING);

	const content = getContentElement();
	content.innerHTML = `
		<p class="signed-in-as" id="signed-in-as"></p>

		<p>
			Search for artists by name, and/or paste a link to a public Spotify playlist to import its artists.
		</p>
		<p class="m-b-40">
      Private playlists and Spotify's own playlists like Today's Top Hits can't be imported.
		</p>

		<div class="form-group">
			<label class="control-label" for="artist-search">Search for artists</label>
			<input type="text" id="artist-search" class="form-control narrow-input" placeholder="eg: Crowded House"
				spellcheck="false" autocomplete="off" />
			<div id="search-status" class="import-status" hidden></div>
		</div>

		<div class="form-group">
			<label class="control-label" for="playlist-input">Paste a public Spotify playlist link</label>
			<div class="playlist-import-row">
				<input type="text" id="playlist-input" class="form-control narrow-input"
					placeholder="https://open.spotify.com/playlist/…" spellcheck="false" autocomplete="off" />
				<button type="button" class="btn btn-primary" id="import-playlist">Import</button>
			</div>
			<span class="form-helper">To get a playlist link: right-click on it <span class="aligned-top">→</span> "Share" <span class="aligned-top">→</span> "Copy link to playlist"</span>
			<div id="playlist-status" class="import-status" hidden></div>
		</div>

		<div id="search-results" class="search-results" hidden></div>

		<!-- The whole "Subscribe to artists" section stays hidden until the
		list has at least one artist (toggled in updateSelectionUi) -->
		<div id="selection-section" hidden>
			<h1>Step 3: subscribe to artists</h1>
			<p id="selection-summary"></p>

			<div class="followed-artists-list-container">
				<div class="followed-artists-list" id="artists-list"></div>
			</div>

			<div class="subscribe-form-container">
				<div class="form-col">
					<h3 id="subscribing-heading" class="m-b-20"></h3>

					<div id="subscribe-form-holder"></div>
				</div>
			</div>
		</div>`;

	//"Signed in as name@example.com. Not you?" (text + link, so built via DOM)
	const signedIn = document.getElementById("signed-in-as")!;
	signedIn.textContent = `Signed in as ${context.emailAddress}. `;
	const notYou = document.createElement("a");
	notYou.href = "#";
	notYou.textContent = "Not you?";
	notYou.addEventListener("click", (event) => {
		event.preventDefault();
		context.onSignOut();
	});
	signedIn.appendChild(notYou);

	document
		.getElementById("import-playlist")!
		.addEventListener("click", () => void importPlaylist());

	const searchInput = document.getElementById("artist-search")! as HTMLInputElement;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	searchInput.addEventListener("input", () => {
		clearTimeout(searchTimer);
		const query = searchInput.value.trim();
		if (query.length < MIN_SEARCH_LENGTH) {
			setStatus("search-status", "", false);
			renderSearchResults([]);
			return;
		}
		searchTimer = setTimeout(() => void runSearch(query), SEARCH_DEBOUNCE_MS);
	});

	renderArtistList();
	renderSubscribeForm();
	updateSelectionUi();
}

function numSelected(): number {
	let selected = 0;
	for (const artist of artists.values()) {
		if (artist.selected) selected++;
	}
	return selected;
}

/** Any 401 means the token expired mid-session: back to the gate (selections are kept) */
function handleExpiredToken(): void {
	pickerContext?.onTokenExpired();
}

async function importPlaylist(): Promise<void> {
	const context = pickerContext;
	if (!context) return;

	const input = document.getElementById("playlist-input") as HTMLInputElement | null;
	const button = document.getElementById("import-playlist") as HTMLButtonElement | null;
	if (!input || !button) return;

	const link = input.value.trim();
	if (!link) {
		setStatus("playlist-status", "Paste a playlist link first.", true);
		return;
	}

	button.disabled = true;
	setStatus("playlist-status", "Importing artists from that playlist…", false);

	try {
		const data = await postJson<PlaylistImportResult>("/api/spotify/playlist-artists", {
			token: context.token,
			playlist: link,
		});

		let added = 0;
		let already = 0;
		for (const artist of data.artists) {
			if (artists.has(artist.id)) {
				already++;
				continue;
			}
			artists.set(artist.id, { ...artist, selected: true });
			added++;
		}

		if (added + already === 0) {
			setStatus("playlist-status", "We couldn't find any artists in that playlist.", true);
		} else {
			const fromName = data.playlistName ? ` from “${data.playlistName}”` : "";
			const alreadyNote =
				already > 0 ? ` (${plural(already, "was", "were")} already in your list)` : "";
			setStatus(
				"playlist-status",
				`Imported ${plural(added, "artist")}${fromName}${alreadyNote}.`,
				false,
			);
			input.value = "";
		}

		renderArtistList();
		updateSelectionUi();
		updateSubscribeForm();
	} catch (e) {
		if (isTokenRejected(e)) {
			handleExpiredToken();
			return;
		}
		setStatus("playlist-status", e instanceof Error ? e.message : String(e), true);
	} finally {
		button.disabled = false;
	}
}

async function runSearch(query: string): Promise<void> {
	const context = pickerContext;
	if (!context) return;

	//Ignore responses that a newer keystroke has superseded
	const sequence = ++searchSequence;
	setStatus("search-status", `Searching for “${query}”…`, false);

	try {
		const data = await postJson<SearchResponse>("/api/spotify/search-artists", {
			token: context.token,
			query,
		});
		if (sequence !== searchSequence) return;

		renderSearchResults(data.artists);
		setStatus(
			"search-status",
			data.artists.length === 0 ? "No artists found – try a different search." : "",
			false,
		);
	} catch (e) {
		if (sequence !== searchSequence) return;
		if (isTokenRejected(e)) {
			handleExpiredToken();
			return;
		}
		renderSearchResults([]);
		setStatus("search-status", e instanceof Error ? e.message : String(e), true);
	}
}

function renderSearchResults(results: SpotifyArtistSummary[]): void {
	lastSearchResults = results;

	//The picker screen can be gone if we signed out while a search was in flight
	const container = document.getElementById("search-results");
	if (!container) return;

	container.textContent = "";
	container.hidden = results.length === 0;

	for (const result of results) {
		const added = artists.has(result.id);

		const tile = document.createElement("div");
		tile.className = `search-result${added ? " added" : ""}`;
		tile.addEventListener("click", () => addArtist(result));

		const image = document.createElement("img");
		image.className = "search-result-image";
		image.src = result.image.url;
		image.alt = result.name;
		image.loading = "lazy";

		const name = document.createElement("div");
		name.className = "search-result-name";
		name.textContent = result.name;
		//Long names ellipsize in the tile: keep the full name on hover
		name.title = result.name;

		const action = document.createElement("div");
		action.className = "search-result-action";
		//Just the check icon when added: the word overflows narrow tiles
		action.textContent = added ? "✓" : "Add";
		action.title = added ? "Added" : "";

		tile.appendChild(image);
		tile.appendChild(name);
		tile.appendChild(action);
		container.appendChild(tile);
	}
}

function addArtist(artist: SpotifyArtistSummary): void {
	if (artists.has(artist.id)) return;

	artists.set(artist.id, { ...artist, selected: true });

	renderArtistList();
	updateSelectionUi();
	updateSubscribeForm();
	renderSearchResults(lastSearchResults);
}

function renderArtistList(): void {
	//The picker screen can be gone if we signed out while a request was in flight
	const list = document.getElementById("artists-list");
	if (!list) return;

	list.textContent = "";
	if (artists.size === 0) return;

	for (const artist of artists.values()) {
		const container = document.createElement("div");
		container.className = `artist-container${artist.selected ? " selected" : ""}`;
		container.addEventListener("click", () => {
			artist.selected = !artist.selected;
			container.className = `artist-container${artist.selected ? " selected" : ""}`;
			updateSelectionUi();
			updateSubscribeForm();
		});

		const square = document.createElement("div");
		square.className = "square";

		const image = document.createElement("img");
		image.className = "artist-image";
		image.src = artist.image.url;
		image.alt = artist.name;
		image.loading = "lazy";
		square.appendChild(image);

		const name = document.createElement("div");
		name.className = "artist-name";
		name.textContent = artist.name;

		container.appendChild(square);
		container.appendChild(name);
		list.appendChild(container);
	}
}

function updateSelectionUi(): void {
	const summary = document.getElementById("selection-summary");
	const selectionSection = document.getElementById("selection-section");
	const hasArtists = artists.size > 0;

	if (selectionSection) {
		//The entire "Subscribe to artists" section (heading, summary, grid,
		//subscribe form) stays hidden until the list has at least one artist
		selectionSection.hidden = !hasArtists;
	}
	if (summary && hasArtists) {
		summary.textContent = `${plural(artists.size, "artist")} in your list, ${numSelected()} selected. Tap or click artists to toggle selection.`;
	}
}

function renderSubscribeForm(): void {
	//The picker screen can be gone if we signed out while a request was in flight
	const holder = document.getElementById("subscribe-form-holder");
	if (!holder) return;

	//No email input: the server resolves the (already verified) subscriber
	//from the magic-link token
	holder.innerHTML = `
		<form id="subscribe-form">
			<button type="submit" class="btn btn-primary btn-lg" id="subscribe-button">Subscribe</button>
		</form>`;

	const form = document.getElementById("subscribe-form")!;
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		void handleSubmit();
	});

	updateSubscribeForm();
}

function updateSubscribeForm(): void {
	const heading = document.getElementById("subscribing-heading");
	const button = document.getElementById("subscribe-button") as HTMLButtonElement | null;
	const selected = numSelected();

	if (heading) {
		heading.textContent = `Subscribing to ${selected} artist${selected === 1 ? "" : "s"}`;
	}
	if (button) {
		button.disabled = selected === 0;
	}
}

async function handleSubmit(): Promise<void> {
	const context = pickerContext;
	if (!context) return;

	const holder = document.getElementById("subscribe-form-holder");
	if (!holder) return;

	holder.innerHTML = '<div class="loading-spinner"></div>';

	try {
		const result = await postJson<SubscribeResult>("/api/subscriptions/subscribe", {
			token: context.token,
			artists: [...artists.values()]
				.filter((artist) => artist.selected)
				.map((artist) => ({ spotifyId: artist.id, name: artist.name })),
		});

		sessionStorage.setItem("subscribeResult", JSON.stringify(result));
		window.location.replace("/subscribe-success");
	} catch (e) {
		if (isTokenRejected(e)) {
			handleExpiredToken();
			return;
		}
		holder.innerHTML = "";
		const error = document.createElement("div");
		error.className = "error-message";
		error.textContent = e instanceof Error ? e.message : String(e);
		holder.appendChild(error);

		const button = document.createElement("button");
		button.type = "button";
		button.className = "btn btn-primary btn-lg m-t-20";
		button.textContent = "Try again";
		button.addEventListener("click", () => {
			renderSubscribeForm();
		});
		holder.appendChild(button);
	}
}
