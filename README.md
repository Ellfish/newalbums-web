# New Albums via Email

The web front-end, API and database for **[newalbumsviaemail.com](https://newalbumsviaemail.com)** — pick the artists you care about (import a public Spotify playlist, search, or both), and get an email when they release a new album. No Spotify login, no account needed, and every email has an unsubscribe link.

Rebuilt from the original [React + ASP.NET app](https://github.com/Ellfish/newalbumsviaemail) onto Cloudflare's platform:

- **[Astro](https://astro.build)** — mostly prerendered static pages, vanilla JS for the interactive subscribe flow (no framework runtime shipped to the browser)
- **[Cloudflare Workers](https://developers.cloudflare.com/workers/)** — on-demand API routes + static asset serving, one deploy
- **[Cloudflare D1](https://developers.cloudflare.com/d1/)** (SQLite at the edge) — subscribers, artists, albums and subscriptions
- **Spotify Client Credentials** — every Spotify call is made server-side with the app's own token (no user login, which is what keeps the app usable under Spotify's development-mode authorized-user cap)
- **Magic-link sign-in** — passwordless: the emailed link both verifies the address and carries a 24h access token, which gates the search/import/subscribe APIs (no searching until the email is verified)
- **Mailgun** for the magic-link + admin notification emails

A companion daily job — a small .NET console app (in a private repo) scheduled on a home NAS — reads and writes this app's database via the token-protected **admin API** below: it polls Spotify for each subscribed artist's releases, emails subscribers when there's a new album, and records the albums it has notified about. The whole system runs comfortably within Cloudflare's free tier.

## Architecture

```
                ┌──────────────────────────────────────────────┐
  Users ───────►│  Cloudflare Worker (this repo)                │
                │  • prerendered Astro pages                     │
                │  • public API (subscribe/verify/unsubscribe)  │
                │  • admin API (token-protected, for the job)   │
                │  • verification + notification emails        │
                └───────────────┬───────────────┬──────────────┘
                │ D1 binding    │ fetch
                ▼               ▼
          ┌──────────┐   ┌───────────┐   ┌──────────┐
          │  D1      │   │  Spotify  │   │ Mailgun  │
          │ (SQLite) │   └───────────┘   └──────────┘
                ▲
                │ admin API over HTTPS (X-Admin-Token)
          ┌─────┴───────────────────────────────────┐
          │  NAS daily job (.NET, private repo):    │
          │  polls Spotify for new releases, sends   │
          │  the new-album notification emails       │
          └─────────────────────────────────────────┘
```

## Pages

| Route | Purpose |
|---|---|
| `/` | Home + how it works + Get Started (link to the artist picker) |
| `/subscribe-to-artists` | Email gate (magic link) → artist picker (public playlist import + artist search) + subscribe |
| `/subscribe-success` | Confirmation + status message |
| `/verify-email` | Email verification (from the emailed link) |
| `/unsubscribe` | Unsubscribe — one artist or all, via the token links in emails |
| `/privacy-policy` | Privacy policy |

## API

Public endpoints (same-origin, POST JSON, called by the pages):

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/request-magic-link` | Step 1: get-or-create the subscriber, then email a 24h magic link |
| `POST /api/auth/validate` | Step 2 (the link click): validate the token + mark the email verified |
| `POST /api/spotify/playlist-artists` | Unique artists of a public playlist (magic-link token required; app token, same-origin only, cached per isolate) |
| `POST /api/spotify/search-artists` | Artist search (magic-link token required; app token, market from the visitor's country, same-origin only, cached per isolate) |
| `POST /api/subscriptions/subscribe` | Subscribe the token's (already verified) subscriber to artists (2000-artist cap) |
| `POST /api/subscriber/verify-email` | Verify an email address (legacy: verification emails sent before the magic-link flow still work) |
| `POST /api/subscriptions/unsubscribe` | Unsubscribe (one artist or all) |

Admin endpoints (require the `X-Admin-Token` header — used by the daily job):

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/ping` | Health check + row counts |
| `GET /api/admin/artists` | All artists with their albums |
| `GET /api/admin/artists/{id}/subscriptions` | Subscriptions for an artist, enriched with subscriber email/verified/token |
| `POST /api/admin/artists/{id}/albums` | Record notified albums (idempotent — safe to re-run the job) |

## Development

Requirements: Node 22+ (LTS) and a Cloudflare account (the free tier is plenty).

```sh
npm install

# Apply the schema + fake test data to your local (miniflare) D1
npx wrangler d1 execute newalbums --local --file db/schema.sql
npx wrangler d1 execute newalbums --local --file db/seed-test.sql

npm run dev     # astro dev on http://localhost:4321 — real workerd + local D1
npm test        # Vitest, run inside workerd via @cloudflare/vitest-plugin
npm run check   # TypeScript checks
```

Local secrets live in `.dev.vars` (gitignored). For local dev you need `ADMIN_TOKEN` plus the Spotify app credentials; deliberately **omitting** `MAILGUN_API_KEY` means local runs never send real email — attempts just return a "not configured" error:

```
ADMIN_TOKEN=<32 random bytes, hex>
SPOTIFY_CLIENT_ID=<from the Spotify dev dashboard>
SPOTIFY_CLIENT_SECRET=<from the Spotify dev dashboard>
```

## Deployment

```sh
npm run build
npx wrangler deploy
```

Production serves `newalbumsviaemail.com` (Worker custom domain) plus the `*.workers.dev` fallback URL. Staging is a separate Worker + D1 pair, selected at build time with the `CLOUDFLARE_ENV` variable:

```sh
# bash
CLOUDFLARE_ENV=staging npm run build && npx wrangler deploy
# PowerShell
$env:CLOUDFLARE_ENV='staging'; npm run build; npx wrangler deploy
```

Non-secret configuration (app name, URLs, admin notification email, Mailgun endpoint/domain, default search market) is in the `vars` of [`wrangler.jsonc`](wrangler.jsonc). Secrets are set with `wrangler secret put` for each environment (`--env staging` for staging): `ADMIN_TOKEN`, `MAILGUN_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` — and are never committed. The Spotify credentials come from the [Spotify developer dashboard](https://developer.spotify.com/dashboard), and the app owner's Spotify account must stay on Premium for development-mode API access.

The `NaAccessTokens` table (magic-link sign-in) is web-app-only — it's not part of the NAS-mirrored schema. Existing remote databases pick it up with the idempotent `npx wrangler d1 execute <database> --remote --file db/schema.sql` (`newalbums` for production, `newalbums-staging` for staging).

## Notes

- The Spotify client ID/secret pair is used server-side only (Worker secrets); the browser never sees any Spotify credential. All Spotify calls use the client-credentials flow with the app's own token — there is no user login anywhere.
- Spotify development-mode quota is counted per developer **account** (shared with the NAS job's polling), which is why the app keeps its Spotify calls lean: per-isolate response caching, search debounce, and a 1,000-track playlist import cap. Spotify's February 2026 changes will eventually restrict playlist contents to playlists the requesting user owns — reading other people's public playlists works for now (postponed for existing integrations), and if/when that lands, playlist import degrades to a clear error message steering people to search.
- The daily job's repo (the .NET app running on the NAS) is private because it contains operational secrets; everything that defines this app's behaviour is here.
