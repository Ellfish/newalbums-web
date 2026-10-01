# New Albums via Email

The web front-end, API and database for **[newalbumsviaemail.com](https://newalbumsviaemail.com)** — log in with Spotify, pick the artists you care about, and get an email when they release a new album. No account needed, and every email has an unsubscribe link.

Rebuilt from the original [React + ASP.NET app](https://github.com/Ellfish/newalbumsviaemail) onto Cloudflare's platform:

- **[Astro](https://astro.build)** — mostly prerendered static pages, vanilla JS for the interactive subscribe flow (no framework runtime shipped to the browser)
- **[Cloudflare Workers](https://developers.cloudflare.com/workers/)** — on-demand API routes + static asset serving, one deploy
- **[Cloudflare D1](https://developers.cloudflare.com/d1/)** (SQLite at the edge) — subscribers, artists, albums and subscriptions
- **Spotify Authorization Code + PKCE** — the whole login flow is client-side, so no Spotify client secret exists in this app
- **Mailgun** for the verification + admin notification emails

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
| `/` | Home + how it works + Get Started (Spotify login) |
| `/spotify-callback/` | PKCE code exchange after Spotify authorization |
| `/subscribe-to-artists` | Artist picker (followed artists grid, top-50 preselected) + email |
| `/subscribe-success` | Confirmation + status message |
| `/verify-email` | Email verification (from the emailed link) |
| `/unsubscribe` | Unsubscribe — one artist or all, via the token links in emails |
| `/privacy-policy` | Privacy policy |

## API

Public endpoints (same-origin, POST JSON, called by the pages):

| Endpoint | Purpose |
|---|---|
| `POST /api/spotify/followed-artists` | Followed artists + top-artist preselection (uses the browser's user access token) |
| `POST /api/spotify/user-email` | The user's Spotify email (prefill + auto-verification) |
| `POST /api/subscriptions/subscribe` | Get-or-create the subscriber, subscribe to artists (2000-artist cap) |
| `POST /api/subscriber/verify-email` | Verify an email address |
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

Local secrets live in `.dev.vars` (gitignored). For local dev you normally only need `ADMIN_TOKEN`; deliberately **omitting** `MAILGUN_API_KEY` means local runs never send real email — attempts just return a "not configured" error:

```
ADMIN_TOKEN=<32 random bytes, hex>
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

Non-secret configuration (app name, URLs, admin notification email, Mailgun endpoint/domain) is in the `vars` of [`wrangler.jsonc`](wrangler.jsonc). Secrets are set with `wrangler secret put` (`ADMIN_TOKEN`, `MAILGUN_API_KEY`) and are never committed.

## Notes

- The Spotify client ID in `src/lib/spotify-auth.ts` is public by design — browser apps ship it in their JS bundle regardless, and with PKCE there is no client secret to protect.
- If you're wondering about Spotify's consent screen showing "your name, username, profile picture, Spotify followers and public playlists" — that's `user-read-private`, granted automatically to every app by Spotify. This app doesn't request it and never reads that data.
- The daily job's repo (the .NET app running on the NAS) is private because it contains operational secrets; everything that defines this app's behaviour is here.
