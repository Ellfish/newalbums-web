# Migration plan: Spotify user login → playlist import + artist search

Status: **ready to implement** · researched and live-verified 10 October 2026

## Background

Spotify's [February 2026 developer-mode changes](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security) cap development-mode apps at **5 authorized users** (plus a Premium requirement for the app owner). The current user-login flow (Authorization Code + PKCE, reading `/me/following` and `/me` with the *visitor's* token) can never serve the public again.

The fix: **remove user login entirely**. All Spotify calls move server-side into the Worker using the **client credentials flow** with the app's own client ID + secret — no end-user authorization, so the 5-user cap is irrelevant. Visitors choose artists in two ways:

- **(a)** paste a link to a public Spotify playlist → we read its artists, or
- **(b)** search for artists directly.

Research verified that (b) is officially supported, and a live smoke test (2026-10-10) confirmed both (a) and (b) work with our existing client ID today.

## Research findings

### Spotify dev-mode rules that apply to this app (existing client ID)

- App owner must have **Spotify Premium** (verified working — token request returns 200).
- Max 5 authorized users — irrelevant now: client credentials involves no user authorization.
- **Endpoint access changes were postponed for existing dev-mode integrations** (March 9 update, no new date announced). Verified live: our client ID still gets old behavior — `GET /search` accepts `limit=50`, and `GET /playlists/{id}/tracks` still returns the full contents of a stranger's public playlist.
- When the postponement lifts, playlist **contents** will only be returned for playlists the requesting user owns/collaborates on — and a client-credentials token has no user at all. **Playlist import is therefore on borrowed time** (see Risks). Search is on the official ["endpoints still available"](https://developer.spotify.com/documentation/web-api/references/changes/february-2026) list and is safe.

### Live smoke test results (2026-10-10, client credentials)

| Probe | Result |
|---|---|
| `POST accounts.spotify.com/api/token` (client credentials) | **200**, `expires_in` 3600 |
| `GET /v1/search?type=artist&q=…&market=AU&limit=10` | **200**, 10 results, artist images included |
| `GET /v1/search` without `market` | 200 with results (still send `market` — correct availability filtering, future-proof) |
| `GET /v1/search` with `limit=50` | 200 with 50 results → confirms postponed/old rules apply to our client ID |
| `GET /v1/search?type=playlist` | 200 (used to locate a test playlist) |
| `GET /v1/playlists/{id}` (metadata) | **200** — name/owner/total available for the import status line |
| `GET /v1/playlists/{id}/tracks` (old endpoint) | **200 — full contents of another user's public playlist** (100/100 tracks) |
| `GET /v1/playlists/{id}/items` (new endpoint) | **200 with full contents** — each entry currently has **both** `track` and `item` keys (transition period) |
| `GET /v1/artists/{id}` | 200 (image enrichment path, if ever needed) |
| `GET /v1/playlists/37i9dQZF1DXcBWIGoYBM5M/tracks` (editorial: Today's Top Hits) | **404** — Spotify-owned/editorial playlists are blocked for dev-mode apps even today |

### Rate limits & quota

- **Rate limit**: rolling 30-second window per app → `429` + `Retry-After` header (seconds). The existing `spotifyFetch` retry logic already handles this; keep it.
- **Dev-mode quota** (separate mechanism): bucketed per endpoint group; since [July 2026](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates) counted **per developer account** — all dev-mode client IDs under one Spotify account share a single quota pool (i.e. this app **and the NAS job's credentials, if under the same account**). Exceeded → `429` with body `reason: "QUOTA_EXCEEDED"`.
- Community data point (March 2026): a ~100-call *burst* to `/artists/{id}/albums` within minutes earned a **24-hour** block (`Retry-After: 85513`). Bursts are punished hard; per-artist fetch loops are the design to avoid.
- Our expected volume (handful of users/week): an import = 1 request per 100 tracks (max 10 requests for a 1,000-track playlist), a search = 1 request per query. Tens of requests per week — trivially safe. **No per-artist enrichment calls** (see decisions) so there are no burst patterns at all.

### Market detection (search)

Verified live on this stack (Astro 7 + `@astrojs/cloudflare` 14, workerd): **`request.cf.country` is populated inside API routes** (`{"hasCf":true,"cfCountry":"AU"}`; local dev shows miniflare's mock, production gets real IP-geolocation values). `Accept-Language` is a poor proxy (language, not country; defaults to "en"/"en-US"). So: **market = `request.cf.country` when present/valid, else the `SPOTIFY_MARKET` var (default "AU")**. Only affects search-result availability filtering; VPN users get their VPN's country — harmless.

## New flow

```
Visitor (no Spotify login)
   │ 1. paste public playlist link and/or search artists
   │ 2. select artists (imports preselected)
   │ 3. email + Subscribe → verification email → verified
   ▼
Cloudflare Worker
   • prerendered Astro pages
   • /api/spotify/*  → Spotify client credentials (app token, cached)
   • /api/subscriptions/* (unchanged shape)
   ▼
Spotify Web API · D1 · Mailgun (all unchanged integrations, no user tokens anywhere)
```

## Implementation

### Phase 1 — Spotify module (server)

- **Delete** `src/lib/spotify-auth.ts` (PKCE flow, user tokens, sessionStorage).
- **Rewrite** `src/lib/spotify.ts` as a server-side client-credentials client:
  - `getAppAccessToken()` — `POST https://accounts.spotify.com/api/token`, `grant_type=client_credentials`, `Authorization: Basic base64(id:secret)`; cache in module scope until `expires_in − 300s`; on a `401` from any API call, refresh once and retry.
  - `searchArtists(query, market)` — `GET /v1/search?type=artist&q=…&market=…&limit=10`; map to the existing `SpotifyArtist` shape via the existing `getImage`.
  - `getPlaylistArtists(input)` —
    - parse the input: `https://open.spotify.com/playlist/{id}?…`, `spotify:playlist:{id}`, or bare ID (base62, 22 chars);
    - `GET /v1/playlists/{id}` for name/owner (import status line);
    - `GET /v1/playlists/{id}/items?limit=100&offset=…`, paginate, **cap 10 pages (1,000 tracks)**;
    - parse each entry as `entry.item ?? entry.track` (works today, future-proof); skip `null` tracks (removed/unavailable) and local tracks / artists without IDs;
    - dedupe artists by ID; tile image = the track's **album art** (`getImage(album.images, 100)`); keep per-artist track counts;
    - friendly, distinct errors: 404 → "not found — note that Spotify-owned playlists (Today's Top Hits, Discover Weekly, etc.) can't be imported"; 403 → private/restricted; empty/absent items → "Spotify no longer allows reading this playlist — try search instead".
  - Keep `spotifyFetch` 429/`Retry-After` retry; surface `reason: "QUOTA_EXCEEDED"` distinctly in error messages.
- **Config**: `wrangler.jsonc` vars → `SPOTIFY_CLIENT_ID` (existing public client ID `b61565f287d0410f9e2f13fc71140fcc`) and `SPOTIFY_MARKET: "AU"`; secret → `SPOTIFY_CLIENT_SECRET` via `.dev.vars` (local) + `wrangler secret put SPOTIFY_CLIENT_SECRET` for **both** prod and staging envs; re-run `npm run generate-types`. **Never commit the client secret** (this repo is public).

### Phase 2 — API endpoints

| Change | Endpoint | Notes |
|---|---|---|
| New | `POST /api/spotify/search-artists` `{query}` | 2–100 char validation; market from `request.cf.country` → `SPOTIFY_MARKET`; per-isolate response cache (~5 min); Origin check |
| New | `POST /api/spotify/playlist-artists` `{playlist}` | Returns `{playlistName, artists}`; same protections; response cache (~1 h) |
| Modify | `POST /api/subscriptions/subscribe` | Remove `spotifyAccessToken` + Spotify-email auto-verify; **all new subscribers verify via email** (existing verified subscribers unaffected) |
| Delete | `POST /api/spotify/followed-artists` | Replaced by playlist import |
| Delete | `POST /api/spotify/user-email` | No user tokens exist anymore |

Abuse protections (these endpoints spend *our* quota): validate Origin header host matches the request's own host (works in dev and prod); cap query length/pages; per-isolate `Map` cache with TTL + size cap (~100 entries) to bound memory.

### Phase 3 — UI

- `src/pages/index.astro` — rewrite copy: "Who is this for?" → anyone with an email (no Spotify account needed); steps → **1** paste a public playlist link and/or search for artists **2** choose which to subscribe to **3** enter email + Subscribe; "Ready?" paragraph → "we never ask you to log in to Spotify; we only store your email and the artists you choose". Delete the PKCE `<script>`; **Get Started becomes a plain static link to `/subscribe-to-artists`** (home fully prerendered). Swap the step-1 image (currently "Allow Spotify access") for a playlist/search-themed asset.
- **Delete** `src/pages/spotify-callback.astro` (optionally remove its redirect URI from the Spotify dashboard).
- `src/pages/subscribe-to-artists.astro` — becomes the picker hub:
  - **Import section**: playlist link input + Import button → `playlist-artists` → adds all unique artists **preselected** with album-art tiles; status line ("Imported 34 artists from 'Favourite Songs'"); inline errors.
  - **Search section**: debounced (~400 ms, ≥2 chars) search box → `search-artists` → ≤10 results with artist images, click to add; already-added artists indicated; dedupe by ID.
  - Existing artist grid, Select All/None, name filter, email form stay; email form drops the Spotify prefill + "different email" warning; verification note always shown.
- `src/layouts/Layout.astro` — update meta description + header subheading ("artists you follow on Spotify" → "artists you choose").
- `src/pages/privacy-policy.astro` — rewrite the Spotify-access paragraph: no login, playlist links read once for import, search terms not stored; update the "last updated" date.
- `README.md` — overhaul: architecture bullets (client credentials, no user login), pages table (remove `/spotify-callback/`, update picker description), API table (new endpoints), development (Spotify secrets in `.dev.vars`), notes (secret handling, quota sharing with the NAS job).

### Phase 4 — Tests & rollout

- Vitest (workerd, `fetch` mocked via `vi.stubGlobal`): playlist input parsing (URL/URI/bare ID/invalids), dedupe + page cap + null/local-track skipping, `item ?? track` parsing, search mapping (market param, limit, image pick), market resolution (`request.cf.country` → fallback), subscribe without a token (always `requiresEmailVerification: true` for new subscribers). `npm run check` + full suite green.
- Rollout: staging build/deploy (`CLOUDFLARE_ENV=staging`) → manually verify a real public playlist link, searches, subscribe + verification email → production deploy → clean up any dashboard redirect URIs.

## Decisions locked in

1. **Playlist-import tiles use the track's album art** (already in the response — zero extra API calls, avoids the burst-quota risk of per-artist `GET /artists/{id}` loops). Search results keep real artist images.
2. **Market**: `request.cf.country` → `SPOTIFY_MARKET` var (default "AU").
3. **All imported artists preselected**; search-added artists selected on add.
4. **Search built to `limit ≤ 10`** even though 50 currently works on the postponed rules — nothing breaks when the postponement lifts.
5. **Playlist contents via `GET /playlists/{id}/items`** with `item ?? track` parsing (works today, and remains the correct endpoint under future rules).
6. **Email verification required for every new subscriber** (no Spotify-email match is possible without user tokens).

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Spotify applies the postponed playlist-contents restriction → other users' public playlists stop being readable via app tokens | Medium, timing unknown | Feature fails gracefully: distinct error message steering to search; no code change needed at that point. Search is the officially-supported core. |
| Dev-mode quota is shared per developer **account** (this app + NAS job, if same account) | Certain (structure) | Keep app-side calls lean: no per-artist fetch loops, response caching, client debounce, 10-page import cap. |
| Owner's Premium lapses → all app Spotify calls rejected (already true for the NAS job today) | Low | Operational awareness only. |
| Editorial/algorithmic playlists 404 for dev-mode apps | Certain (verified) | Covered by explicit error copy. |

## Out of scope / unchanged

- D1 schema and data (artists are still get-or-created by `SpotifyId`).
- NAS daily job (admin API consumers; `GET /artists/{id}/albums` and `GET /albums/{id}` are on the still-available list).
- Admin API, Mailgun emails, `/verify-email`, `/unsubscribe`, `/subscribe-success` pages.

## References

- [Update on Developer Access and Platform Security (Feb 2026, with March 9 postponement update)](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)
- [Web API Changelog — February 2026 (endpoint changes + still-available list)](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)
- [February 2026 Migration Guide (playlist `items` owner-only rule, search limit)](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Web API quota updates for Development Mode (July 2026, per-account quota)](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates)
- [Rate Limits concept page](https://developer.spotify.com/documentation/web-api/concepts/rate-limits) · [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [Client Credentials Flow tutorial](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow)
- Smoke test executed 2026-10-10 against the production client ID using live credentials (results above).
