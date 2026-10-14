# JobRadar

JobRadar aggregates job listings from many company boards and job sources into one searchable, filterable feed. Signed-in users can favorite, track, tag and hide listings, and can read their feed through a keyed public API.

## Stack

- Next.js 16 (App Router, `cacheComponents`), React 19, Tailwind 4
- Auth.js v5 (`next-auth` beta), JWT sessions, GitHub and Google providers
- Neon Postgres via `postgres.js` (raw SQL, zod validation)
- Deployed on Vercel (hourly refresh via GitHub Actions); Playwright / Browserless for browser-based adapters
- Tests: vitest with PGlite (in-process Postgres)

## Setup

Requires Node 24 (the version CI uses) and pnpm (see `packageManager` in `package.json`).

```bash
pnpm install
cp .env.example .env.local   # fill in values
pnpm db:migrate
pnpm db:seed                 # optional: seed boards
pnpm dev                     # http://localhost:3000
```

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon pooled connection string used at runtime |
| `DATABASE_URL_UNPOOLED` | recommended | Direct connection for migrate/seed/backfill scripts (falls back to `DATABASE_URL`) |
| `AUTH_SECRET` | yes | Auth.js JWT secret |
| `AUTH_URL` | yes in prod | Canonical public URL |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | one provider needed | GitHub sign-in (enabled when both set) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | one provider needed | Google sign-in (enabled when both set) |
| `ADMIN_EMAIL` | no | Email granted the admin role |
| `CRON_SECRET` | yes for cron | Bearer secret for `/api/refresh/cron`; requests are rejected if unset |
| `REFRESH_BOARDS_PER_TICK` | no | Boards refreshed per cron tick (default 4) |
| `API_RATE_LIMIT_PER_HOUR` | no | Public API limit per key per hour (default 600) |
| `BROWSERLESS_WS_URL` | no | Remote Browserless websocket (with token); enables browser adapters on Vercel |
| `JOBRADAR_DISABLE_BROWSER` | no | `1` disables browser adapters |
| `REED_API_KEY` | no | Enables the Reed adapter |
| `APP_URL` | no | Base URL in the bot User-Agent |
| `ENABLE_TEST_LOGIN` | no | `1` enables a test login provider outside production only |
| `JOBRADAR_LOG_SQL` | no | `1` logs SQL in production |

`.env*` files are git-ignored except `.env.example`.

## Database

- Migrations live in `db/migrations/NNN_*.sql` and run with `pnpm db:migrate`.
- Review every migration before running it against production; never run one against prod unreviewed.
- `pnpm db:seed` seeds boards; `pnpm db:backfill-country` backfills listing countries.

## Tests

```bash
pnpm test        # vitest; database tests use PGlite, no external DB needed
pnpm lint
pnpm exec tsc --noEmit
```

## Deploy

`vercel.json` sets the build command to `pnpm db:migrate && pnpm build`, so every deploy migrates its own database. Point Preview `DATABASE_URL`/`DATABASE_URL_UNPOOLED` at a Neon staging branch so previews never migrate production.

## Cron / refresh

The Vercel Hobby plan only allows daily crons, so `vercel.json` calls `/api/refresh/cron` once a day (06:00 UTC) as a fallback, and `.github/workflows/refresh-cron.yml` calls it hourly. Both send `Authorization: Bearer $CRON_SECRET`; add a `CRON_SECRET` repository secret on GitHub with the same value as Vercel production (and optionally an `APP_URL` repository variable). Without the secret the workflow skips. Each tick refreshes up to `REFRESH_BOARDS_PER_TICK` boards (fan-out) within the route's 60s budget. Admins can also trigger a refresh via `/api/refresh`.

## Roles

A user whose email matches `ADMIN_EMAIL` is an admin; everyone else is a regular user.

## Public API

Create a key in the app's settings, then send it as `Authorization: Bearer <key>` (or `x-api-key: <key>`).

- `GET /api/v1/jobs` – paginated listings for the key owner
- `GET /api/v1/jobs/:id` – one listing
- `GET /api/v1/meta` – facets/metadata

Query params for `/jobs`: `q`, `status` (`new|favorite|applied`), `remote` (`1|anywhere|restricted`), `visa=1`, repeatable `skill`, `country`, `company`, `source`, `page` (default 1), `pageSize` (default 25, max 200).

Limit: 600 requests per key per hour (override with `API_RATE_LIMIT_PER_HOUR`); exceeding it returns `429` with `Retry-After`. Errors: `401` unauthorized, `403` revoked key, `503` if verification or the rate store is unavailable (fails closed). CORS is enabled.

## Scraper policy

JobRadar identifies itself honestly with the user agent `JobRadarBot/1.0 (+<app>/bot)`, fetches and obeys each origin's `robots.txt` (agent `jobradarbot`; unreachable robots.txt is treated as disallow), and publishes details on the `/bot` page. Fetches go through an SSRF-safe fetch layer.

## Layout

- `src/` app code; `db/migrations/` SQL; `scripts/` CLI tasks; `scripts/recon/` throwaway scraping probes
- `docs/` see [docs/README.md](docs/README.md)
