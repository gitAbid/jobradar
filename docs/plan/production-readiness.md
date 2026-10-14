# Production-readiness task board

- **Branch:** `prod-readiness`.
- **Workflow:** run `/fix-next [ID]` (see `.claude/commands/fix-next.md`). Opus orchestrates and reviews; `implementer` (Sonnet) writes code; `researcher` (Haiku) does research.
- **Sources:** `docs/audit/2026-10-14-production-readiness.md` (security/backend) and `docs/audit/2026-10-14-ui-audit.md` (UI).

**Decisions:**
- **Users and auth:** the app is multi-user, using Auth.js with GitHub and Google OAuth. Boards and listings are shared and managed by admins. Everything else is per user: saved/applied/hidden status, tags, follows, pins, settings and API keys.
- **Database:** Neon, with SQL-side filtering and a shared `'use cache: remote'` cache, in place of the local-first layer. The local-first layer is deleted only after the cache is proven.
- **Next.js:** 16.3.x. Read `node_modules/next/dist/docs/` before writing Next-specific code.

**Gates (every card):** `pnpm exec tsc --noEmit && pnpm lint && pnpm test`.

**Phase start commits:** P0 `a40096e`, P1 `b5fd9f6`, P2 `66db546`.

---

## Phase 0 — Safety net

## P0.1 Workflow + branch setup  [x] (Opus)
Done: branch, WIP snapshot commit, agents, `/fix-next`, this board, UI audit doc.

## P0.2 GitHub Actions CI  [x]   model: sonnet   depends: P0.1
**Goal:** every push and PR runs the quality gates.

**Files:** `.github/workflows/ci.yml` (new).

**Acceptance:**
- Triggers on `push` to any branch and on `pull_request`.
- Runs on ubuntu-latest with Node 24. Sets up pnpm via `pnpm/action-setup` (the version comes from the `packageManager` field in package.json), then `pnpm install --frozen-lockfile`.
- Steps run in order: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm audit --prod --audit-level=high`.
- Build env: `JOBRADAR_DISABLE_BROWSER=1`. `DATABASE_URL` is unset, so the build must not require it; verify this locally with `env -u DATABASE_URL pnpm build`.
- Caches the pnpm store.

**Gates:** tsc, lint, test, build.

## P0.3 Upgrade Next.js + patch vulnerable deps  [x]   model: sonnet   depends: P0.1
**Goal:** `pnpm audit --prod` reports zero high or critical advisories.

**Files:** `package.json`, `pnpm-lock.yaml`.

**Acceptance:**
- `next` and `eslint-config-next` are at the latest 16.3.x, which must be ≥16.3.8.
- `sharp` (transitive) resolves to ≥0.35.5 and `source-map-js` to ≥1.2.2. Use `pnpm.overrides` only if a normal update can't get there.
- `pnpm audit --prod --audit-level=high` exits 0.
- The build succeeds.

**Gates:** tsc, lint, test, build.

## P0.4 Lint clean + vitest config  [x]   model: sonnet   depends: P0.1
**Goal:** `pnpm lint` exits with 0 errors and 0 warnings.

**Files:** `src/components/RefreshStatusBar.tsx`, `src/app/actions.ts`, `src/lib/adapters/index.ts`, `vitest.config.ts` → `vitest.config.mts`.

**Acceptance:**
- `RefreshStatusBar.tsx:50` no longer calls `Date.now()` during render. Compute `summaryFresh` from state set in an effect or timer, without changing the behaviour: the summary still hides after `SUMMARY_FRESH_MS`.
- Remove the unused `q` import in `actions.ts` and the unused `parseNextJobzRsc` import in `adapters/index.ts`.
- Vitest runs without the CJS-config warning.

**Gates:** tsc, lint, test.

---

## Phase 1 — Security quick wins

## P1.1 Fail-closed cron auth  [x]   model: sonnet   depends: P0.4
**Goal:** cron endpoints reject every request when `CRON_SECRET` is missing or wrong.

**Files:** `src/lib/cron-auth.ts` (new), `src/app/api/refresh/cron/route.ts`, `src/app/api/sync/blob/route.ts`, `tests/cron-auth.test.ts` (new).

**Acceptance:**
- `isAuthorizedCron(request): boolean`:
  - returns false when the env var is unset or empty;
  - compares `Bearer <secret>` with `crypto.timingSafeEqual` (with a length check first).
- Both routes return 401 when unauthorized. If the secret is unset, they log an error once.
- Tests cover: secret unset, wrong secret, wrong length, correct secret.

**Gates:** tsc, lint, test.

## P1.2 Stop inlining secrets at build time  [x]   model: sonnet   depends: P0.4
**Goal:** secrets are read at runtime only.

**Files:** `next.config.ts`.

**Acceptance:**
- The `env:` block is removed and nothing else changes.
- `grep -r` for the first 20 chars of each secret in `.next/server` after `pnpm build` finds nothing. Report only the counts; never print the values.

**USER ACTION after merge:**
- Set `DATABASE_URL`, `CRON_SECRET`, `REED_API_KEY` and `BROWSERLESS_WS_URL` in Vercel project env.
- Rotate the Neon password, `CRON_SECRET` and the Browserless token.

**Gates:** tsc, lint, test, build.

## P1.3 SSRF-safe fetch  [x]   model: sonnet   depends: P0.4
**Goal:** server-side fetches of board URLs can't reach internal networks.

**Research:** `docs/research/ssrf-safe-fetch.md`. The question: how to pin DNS in Node 24 fetch/undici so the validated IP is the one connected to, e.g. an undici `Agent` with a custom `connect.lookup`; and how to handle redirects.

**Files:** `src/lib/safe-fetch.ts` (new), `src/lib/adapters/index.ts` (`fetchText` uses `safeFetch`), `src/app/actions.ts` (`boardSchema.url` limited to http(s)), `tests/safe-fetch.test.ts` (new).

**Acceptance:**
- Only `http:` and `https:` URLs are allowed.
- Resolved IPs in these ranges are rejected: loopback, RFC1918, link-local (169.254/16, fe80::/10), CGNAT 100.64/10, 0.0.0.0/8, ::1, fc00::/7, and IPv4-mapped IPv6 forms of all of these.
- `redirect: "manual"`, at most 5 hops, and every hop is re-validated.
- The response body is capped at 10 MB.
- Timeout behaviour is unchanged.
- Tests use an injectable resolver, with no real network.

**Gates:** tsc, lint, test.

## P1.4 Validate listing URLs at ingest  [x]   model: sonnet   depends: P0.4
**Goal:** only http(s) listing URLs are stored.

**Files:** `src/lib/refresh.ts` (`upsertListings`) or `src/db/index.ts` (`insertListings` filter), `tests/refresh.test.ts`.

**Acceptance:**
- Rows whose `url` isn't parseable as `http:` or `https:` are dropped, the same way rows with no title are dropped.
- A test covers `javascript:`, `data:` and relative URLs.

**Gates:** tsc, lint, test.

## P1.5 Public API: auth before load, fail closed  [x]   model: sonnet   depends: P0.4
**Goal:** unauthenticated `/api/v1/*` requests never touch the database.

**Files:** `src/lib/api/jobs.ts`, `src/app/api/v1/jobs/route.ts`, `src/app/api/v1/jobs/[id]/route.ts`, `src/app/api/v1/meta/route.ts`, `tests/api-jobs.test.ts`.

**Acceptance:**
- Routes authenticate first and only then load the pool. Restructure so the `*Response` functions take a pool loader rather than a pool.
- Remove the breaker-down fail-open branch in `requireAuth`. When the key can't be verified because the DB is unreachable, respond `503 {error:"unavailable"}`.
- Tests:
  - a missing or invalid key returns 401 and the pool loader is never called;
  - the DB being down during auth returns 503.

**Gates:** tsc, lint, test.

## P1.6 Security headers  [x]   model: sonnet   depends: P1.2
**Goal:** sensible default security headers on every route.

**Files:** `next.config.ts` (`headers()`).

**Acceptance:**
- Headers set: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, mic and geolocation off), and `Strict-Transport-Security` (production only).
- The CSP allows what the app actually needs: `'self'` plus inline styles if Tailwind or Next require them. Follow the CSP guide in `node_modules/next/dist/docs/`; nonces are optional.
- The app renders with no CSP console errors. Verify with `pnpm build && pnpm start` and a curl of the headers.

**Gates:** tsc, lint, test, build.

---

## Phase 2 — Data layer (serial: P2.1 → P2.2 → P2.0a → P2.0b → P2.0c → P2.3 → P2.4 → P2.5)

**USER ACTION before P2.2 runs against real data:** create a Neon branch named `staging` and provide its URL as `STAGING_DATABASE_URL` in `.env.local`.

## P2.1 Migration runner research  [x]   model: haiku   depends: P1.*
**Question:** what is the simplest robust migration approach for raw SQL with postgres.js on Neon and Vercel?

**Leaning:** `db/migrations/NNN_name.sql`, plus a ~60-line `scripts/migrate.ts` that keeps a `schema_migrations` table, runs each file in a transaction, and takes an advisory lock. It is run by `pnpm db:migrate` before `next build` in Vercel's build command.

**Also cover:** Neon preview branches per PR (the Vercel integration), and whether to use the pooled or the direct URL for DDL.

**Output:** `docs/research/migrations.md`.

## P2.2 Baseline migration + seed script  [x]   model: sonnet   depends: P2.1
**Goal:** schema changes go through migrations, not request-time DDL.

**Files:**
- `db/migrations/001_baseline.sql` (new): the DDL and RLS statements from `ensureSchema()` in `src/db/remote.ts`, verbatim and idempotent.
- `scripts/migrate.ts` (new).
- `scripts/seed.ts` (new): uses `SEED_BOARDS` from `src/db/seed.ts`.
- `package.json` scripts: `db:migrate`, `db:seed`.
- `src/db/remote.ts`: `ensureSchema` removed, and its callers updated.
- `tests/migrate.test.ts`.

**Research:** `docs/research/migrations.md`.

**Acceptance:**
- Running the migrations twice is a no-op.
- The runner holds an advisory lock.
- The app no longer issues DDL at runtime.
- Running against `STAGING_DATABASE_URL` works. Opus runs this, not the implementer. **PENDING: blocked on the USER ACTION (staging branch); run before P2.0a's migration is applied anywhere.**

**Gates:** tsc, lint, test, build.

## P2.0a SQL-side feed query builder  [x]   model: sonnet   depends: P2.2
**Goal:** each page or API request fetches only one page of rows plus aggregated facet counts. No full-table reads.

**Files:**
- `db/migrations/002_feed_index.sql` (new): index on `coalesce(posted_at, fetched_at) desc` (plus anything the builder's ORDER BY needs). No tsvector: search keeps today's substring semantics (see below).
- `src/lib/job-query.ts` (new): a pure SQL builder (`buildJobQuery(params, globalKeywords, opts) → {text, values}` pieces) plus an executor that takes a `(text, values) => rows` function, so tests can run it on PGlite and prod runs it via `remoteQuery` from `src/db/remote.ts`.
- `src/lib/job-view.ts`: keeps its types and its public `JobView` shape; keep the in-memory `buildJobView` exported (the parity test's oracle) and add an async SQL-backed entry point.
- `src/app/page.tsx`, `src/app/bangladesh/page.tsx`, `src/app/following/page.tsx`, `src/lib/api/jobs.ts`: replace `loadListingsPool` and the full-table `select`s.
- `tests/job-query.test.ts`; `package.json` (devDependency `@electric-sql/pglite`, allowed).

**Reuse:**
- the filter semantics in `src/lib/filters.ts` and `src/lib/job-view.ts`;
- the facet definitions in `src/lib/facets.ts` (`COUNTRY_FACETS`, `countryFacetValue`) and `src/lib/bd.ts`;
- `attachDescriptions` in `src/db/index.ts`.

**Design decisions (Opus):**
- **Execute against Postgres directly** (`remoteQuery`), not through `q()`: `q()` reads the local SQLite mirror, which can't run this SQL. Until P2.0b lands the feed hits Neon per request — fine on this branch, don't deploy in between.
- **Parity beats cleverness.** `q` = case-insensitive substring over title/company/location/tags/skills (`ILIKE` with `%`/`_`/`\` escaped). Global/board keywords = word-boundary regex: translate `keywordRegex` to a Postgres ARE (`~*`, `\b` → `\y`), passed as a parameter. Country facet = a SQL `CASE` generated from `COUNTRY_FACETS` (each JS regex source translated `\b` → `\y`, `~*`), falling back exactly like `countryFacetValue`. Add a unit test that every `COUNTRY_FACETS` regex translates. Bangladesh prefilter: same translation of the `bd.ts` regex(es).
- Dedupe identical postings (`lower(company)|lower(title)`) with `distinct on`, keeping the same row the in-memory pipeline keeps (first in pool order); totals count deduped rows.
- Cascading facets: each facet's counts apply every filter except its own selection; selected values stay listed at count 0. Top-N limits from `topValues`.
- `tags`/`skills` are JSON text today: use `::jsonb` (P2.4 converts the columns).

**Acceptance:**
- Results for the same params match the old in-memory pipeline. The parity test loads migrations 001+002 into PGlite, inserts fixture listings (with tricky cases: `javascript` vs `java`, `%`/`_` in q, duplicates, hidden rows, multiple countries, remote scopes), and compares `entries` ids/order, totals, pages and facets with `buildJobView` for: q, status, remote (1/anywhere/restricted), visa, skill/country/company/source facets (incl. multi-select), global keywords, showAll, and paging (incl. out-of-range page).
- All values are parameterized (no user input concatenated into SQL).
- One page response from Neon is under 50 KB; log bytes in dev.

**Gates:** tsc, lint, test, build.

## P2.0b Shared listings cache  [ ]   model: sonnet   depends: P2.0a
**Goal:** shared listing reads hit Neon about once per refresh.

**Research:** `docs/research/next16-cache.md`. Cover:
- the Next 16.3 `cacheComponents: true` implications for this app, which uses `connection()` and `searchParams`;
- `'use cache: remote'` on Vercel;
- `cacheTag` / `cacheLife` / `revalidateTag(tag, 'max')`;
- what must change in pages that call `await connection()`.

Sources: `node_modules/next/dist/docs/` only.

**Files:** `next.config.ts`, `src/lib/job-query.ts` (cached wrappers), `src/lib/refresh.ts` (`revalidateTag('listings')` at the end of `executeRun`), `src/app/actions.ts` (board CRUD revalidates the tag), the affected pages.

**Acceptance:**
- Shared queries (listings page, facet counts, board list) are cached under the tag `listings`. Cache keys include all filter params.
- Per-user data is never inside a shared cache entry.
- A test or dev log shows a second identical request runs no listings SQL.
- `pnpm build` is green.

**Design decisions (Opus, from the research):**
- Enable `cacheComponents: true`; remove every `export const dynamic = "force-dynamic"` the research lists and add `await connection()` where it says. Pages keep `await connection()`.
- Cache at the SQL layer: a `'use cache: remote'` wrapper around the feed query (`runJobQuery` with the remote executor) and `fetchListingById`, keyed by serializable args only (the normalised params object, the global-keyword list, opts). `cacheTag('listings')` + a custom `cacheLife` with revalidate ≈ 15 min as a backstop, in case a background invalidation is missed.
- Invalidate: `revalidateTag('listings', 'max')` at the end of `executeRun` (wrap in try/catch and log: it runs in `after()`, which isn't documented as a request scope). Server actions that change listings or boards (status, tags, board CRUD/toggle) call `updateTag('listings')`. Status still lives on `listings` until Phase 3, so status actions must invalidate too.
- Per-user data (followed companies, pinned countries) stays outside the cached function.
- Proof: a dev-only log line inside the uncached SQL path (`[jobradar] feed SQL`). Verify with `pnpm build && pnpm start` on a spare port: request `/` twice and count the log lines (read-only queries against the configured DB are fine). Report the counts.

**Gates:** tsc, lint, test, build.

## P2.0c Neon usage metrics  [x]   model: sonnet   depends: P2.0b
**Goal:** show Neon usage before it hits caps.

**Files:** `src/db/remote.ts` (count queries and approximate response bytes per process, using an hourly bucket), `src/app/api/health/route.ts` (new; replaces `api/db-status` in P2.3), `tests/`.

**Acceptance:**
- `/api/health` returns `{db:"up"|"down", queriesLastHour, approxBytesLastHour}` with no error strings.
- Usage is logged hourly.

**Gates:** tsc, lint, test.

## P2.3 Remove local-first layer  [ ]   model: sonnet   depends: P2.0c
**Goal:** a single Neon data path.

**Files:**
- `src/db/index.ts`: `q`, `qOne` and `run` become thin postgres.js wrappers. Keep `setRemoteHarness` as the test seam.
- `src/db/errors.ts` (new): `withTimeout` and `classifyRemoteError` move here from `translate.ts`.
- Delete:
  - `src/db/local-store.ts`, `src/db/outbox.ts`, `src/db/sync.ts`, `src/db/translate.ts`, `src/db/remote-health.ts`;
  - `src/lib/blob-sync.ts` and `src/app/api/sync/`;
  - `tests/local-db.test.ts` and `tests/blob-sync.test.ts`;
  - `src/app/api/db-status/`;
  - `src/components/DbStatusBadge.tsx` and its usage.
- `vercel.json`: drop the blob cron.
- `src/instrumentation.ts`: drop the sync init.
- `src/app/actions.ts` and `src/app/api-keys/actions.ts`: drop `flushBlobOps`; `commit()` only revalidates.
- `package.json`: remove `@vercel/blob`.

**Acceptance:**
- `grep` finds no references to the deleted modules.
- All remaining tests pass. Adapt `tests/api-jobs.test.ts` and `tests/api-keys-store.test.ts` to the harness.
- A DB failure throws, so the error boundary from P5.4 handles it.

**Gates:** tsc, lint, test, build.

## P2.4 Proper column types  [ ]   model: sonnet   depends: P2.3
**Goal:** Postgres-native types.

**Files:** `db/migrations/003_types.sql`, `src/db/index.ts` (`rowToListing`, `rowToBoard`, `insertListings`, `persistEnrichment`), `src/lib/api/keys-store.ts`, `src/lib/settings.ts`, affected tests.

**Acceptance:**
- Text timestamps become `timestamptz`, with `using` casts.
- 0/1 int flags become `boolean`.
- JSON-in-text columns (`tags`, `skills`, `user_tags`, `filter_keywords`) become `jsonb`.
- The mappers return the same TypeScript types as before.
- The migration is tested against `STAGING_DATABASE_URL`; Opus runs it.

**Gates:** tsc, lint, test, build.

## P2.5 Atomic refresh single-flight  [ ]   model: sonnet   depends: P2.4
**Goal:** two instances can never run a refresh at the same time.

**Files:** `src/lib/refresh-run-store.ts`, `src/lib/refresh.ts`, `tests/refresh-run.test.ts`.

**Acceptance:**
- `beginTrackedRun` uses `pg_try_advisory_lock(<const>)`, held for the run and released in `finally`. Alternatively, an atomic `insert … on conflict do nothing` lock row with an expiry.
- The read-then-write race is gone.
- Tests cover concurrent begin calls.

**Gates:** tsc, lint, test.

---

## Phase 3 — Multi-user (serial)

**USER ACTION before P3.3:**
- Create GitHub and Google OAuth apps.
- Set `AUTH_SECRET`, `AUTH_GITHUB_ID`/`SECRET`, `AUTH_GOOGLE_ID`/`SECRET` and `ADMIN_EMAIL` locally and in Vercel.

## P3.1 Auth.js research  [ ]   model: haiku   depends: P2.5
**Question:** how should Auth.js v5 be set up on Next 16.3 (`proxy.ts`, App Router) with GitHub and Google?

**Pick one adapter strategy, with reasons:**
- `@auth/pg-adapter` with its own small `pg` pool;
- `@auth/neon-adapter`;
- JWT sessions plus our own `users` upsert in the `signIn` callback, using postgres.js.

**Also cover:** how to read the session in server actions and route handlers; Edge vs Node for `proxy.ts`; testing with a credentials provider in dev and e2e only.

**Output:** `docs/research/authjs.md`.

## P3.2 Multi-user schema  [ ]   model: sonnet   depends: P3.1
**Files:** `db/migrations/004_users.sql`, `tests/`.

**Acceptance:**
- Auth tables as required by P3.1, plus `users.role text check in ('admin','user') default 'user'`.
- `user_listing_state(user_id, listing_id, status, user_tags jsonb, updated_at)`, with PK `(user_id, listing_id)` and cascade deletes.
- `user_id` (FK) added to `followed_companies`, `pinned_countries` and `api_keys`. Unique constraints become per user.
- A `user_settings(user_id, key, value)` table. `app_settings` stays system-only.
- Old `listings.status` and `listings.user_tags` are kept until P3.4 migrates the data. Write a backfill function, invoked on the first sign-in of `ADMIN_EMAIL`, that copies the global state to that user.

**Gates:** tsc, lint, test.

## P3.3 Auth wiring + authz helpers  [ ]   model: sonnet   depends: P3.2
**Files:** `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/proxy.ts`, `src/lib/authz.ts`, `src/app/signin/page.tsx`, `src/components/UserMenu.tsx`, `src/app/layout.tsx`, `package.json`.

**Research:** `docs/research/authjs.md`.

**Acceptance:**
- `requireUser()` returns `{id, email, role}` or throws a 401-style error. `requireAdmin()` throws a 403-style error.
- The proxy redirects anonymous visitors to `/signin`.
- These stay public: `/signin`, the `/api/auth/*` routes, the `/api/v1/*` routes (API-key auth), cron routes (secret auth), `/api/health`, static assets, and the landing page from P5.7.
- The first sign-in of `ADMIN_EMAIL` gets `role='admin'` and runs the backfill.

**Gates:** tsc, lint, test, build.

## P3.4 Scope data by user  [ ]   model: sonnet   depends: P3.3
**Files:** `src/app/actions.ts`, `src/app/api-keys/actions.ts`, `src/lib/settings.ts`, `src/lib/job-query.ts`, `src/app/{page,applied,following,bangladesh,boards,api-keys}/page.tsx`, `src/app/layout.tsx`, `db/migrations/005_drop_global_state.sql`, tests.

**Acceptance:**
- Every server action starts with `requireUser()`.
- Admin-only: board add/update/toggle/delete/test, the refresh interval, and refresh.
- Status and tags are read from and written to `user_listing_state`, via a left join in the feed query. That join is per user and must be **outside** the shared cache. Fetch user state for the visible ids as a second query.
- Follows, pins and settings are scoped by `user_id`.
- The migration drops `listings.status` and `listings.user_tags`.

**Gates:** tsc, lint, test, build.

## P3.5 Per-user API keys + rate limit  [ ]   model: sonnet   depends: P3.4
**Files:** `src/lib/api/keys.ts`, `src/lib/api/keys-store.ts`, `src/lib/api/jobs.ts`, `db/migrations/006_rate_limit.sql`, tests.

**Acceptance:**
- Keys belong to a user and are listed and revoked only by their owner.
- `/api/v1` responses use the key owner's status, and `hidden` is excluded for that user.
- Fixed-window rate limit: an `api_rate(key_id, window_start, count)` table, incremented via upsert. Default 600 requests/hour. Over the limit returns 429 with a `Retry-After` header.

**Gates:** tsc, lint, test.

## P3.6 Expiry + admin-only refresh routes  [ ]   model: sonnet   depends: P3.4
**Files:** `src/lib/refresh.ts` (`expireOldListings`), `src/app/api/refresh/route.ts`, `src/app/api/refresh/status/route.ts`, tests.

**Acceptance:**
- Expiry never deletes a listing that has any `user_listing_state` row with status favorite or applied.
- `POST /api/refresh` and `GET /status` require an admin session.

**Gates:** tsc, lint, test.

## P3.7 Authorization test suite  [ ]   model: sonnet   depends: P3.5, P3.6
**Files:** `tests/authz.test.ts`.

**Acceptance:**
- For every server action and every non-public route: anonymous gets 401 or a redirect, a user hitting an admin-only target gets 403, and user A can't read or modify B's state, follows, pins, keys or settings.

**Gates:** tsc, lint, test.

---

## Phase 4 — Reliability

## P4.2 Refresh fan-out  [ ]   model: sonnet   depends: P3.6
**Files:** `src/lib/refresh.ts`, `src/app/api/refresh/cron/route.ts`, `vercel.json`, `src/lib/refresh-run-store.ts`, tests.

**Acceptance:**
- Each cron tick processes the N (env, default 4) most-stale enabled boards, using a per-board advisory lock, within `maxDuration`.
- The cron becomes hourly.
- Remove the 5-minute stale heuristic.
- `revalidateTag('listings')` runs once per tick if any rows changed.

## P4.3 Observability  [ ]   model: sonnet   depends: P4.2
**USER ACTION:** create a Sentry project and set `SENTRY_DSN`.

**Files:** `src/lib/logger.ts`, Sentry config per `@sentry/nextjs` docs, `src/instrumentation.ts`, and replacing `console.*` in `src/lib`, `src/db` and `src/app`.

**Acceptance:**
- Structured JSON logs.
- Errors are captured in Sentry.
- Refresh failures and cron non-2xx responses are reported.

## P4.4 playwright → playwright-core  [ ]   model: sonnet   depends: P0.3
**Files:** `package.json`, `src/lib/adapters/browser.ts`, `next.config.ts` (tracing includes).

**Acceptance:**
- The prod dependency is `playwright-core`; `playwright` moves to devDependencies.
- Local launch still works in dev.
- The build is green.

## P4.5 Scraper compliance research  [ ]   model: haiku   depends: P0.1
**Question:** for each board source in `src/db/seed.ts`, what do its ToS and robots.txt say about automated access, and is there an official API or RSS feed?

**Output:** `docs/research/sources-tos.md`, as a table with columns source / allowed? / API available / recommendation.

## P4.6 Honest UA + robots.txt  [ ]   model: sonnet   depends: P4.5, P1.3
**Files:** `src/lib/safe-fetch.ts`, `src/lib/adapters/*`, `src/lib/adapters/browser.ts`.

**Acceptance:**
- UA: `JobRadarBot/1.0 (+<APP_URL>/bot)`.
- robots.txt is checked and cached per host for 24h. Disallowed paths are skipped and recorded as the board status.
- Sources flagged "disallowed" in the research are disabled in seed.

---

## Phase 5 — UI / product polish

See `docs/audit/2026-10-14-ui-audit.md`. P5.1 and P5.2 may run in parallel with Phases 1–2 in a worktree. P5.3 onward depends on P3.4.

## P5.1 Design tokens + dark mode + font  [ ]   model: sonnet   depends: P0.4
**Files:** `src/app/globals.css`, `src/app/layout.tsx`.

**Acceptance:**
- `@theme` defines:
  - radius scale;
  - 3–4 elevation shadows, replacing the ~13 arbitrary `shadow-[…]` values;
  - a type scale with tokens for 10/11/13/15px;
  - tracking tokens;
  - semantic colours: `primary` (teal), `accent` (coral, full 50–900, which fixes the missing `coral-300`), `danger`, `muted` (≥4.5:1 on its background).
- Dark-mode token overrides (`prefers-color-scheme`, plus a `data-theme` override). Remove `color-scheme: light`.
- Geist and Geist Mono are loaded via `next/font/google` and set the `--font-geist-*` variables.
- Remove the dead `ink`/`sand` tokens and the global `* {border-color}` reset. The raw hex values in `globals.css` (focus ring, selection, skip link) become tokens.
- Don't touch component files in this card.

**Gates:** tsc, lint, test, build.

## P5.2 UI primitives  [ ]   model: sonnet   depends: P5.1
**Files:** `src/components/ui/{Button,IconButton,Badge,Card,Input,Field,PageHero,StatTile,EmptyState,ConfirmDialog,Toast}.tsx` (new), `tests/ui-primitives.test.tsx` (add `@testing-library/react` and `jsdom` as dev dependencies).

**Acceptance:**
- `Button`: variants primary/secondary/ghost/danger, sizes sm/md, a `pending` prop that shows a spinner, sets `aria-busy` and disables the button. Focus ring from tokens.
- `IconButton`: requires `label`, which becomes its `aria-label`.
- `ConfirmDialog` is built on `<dialog>`, with focus trap, Esc and focus return.
- `Toast`: a provider plus `useToast`, an `aria-live` region, and an optional action button (for Undo).
- `EmptyState`: variants `empty` and `filtered`.
- Only design tokens are used; no arbitrary values.
- Tests cover the a11y attributes.

**Gates:** tsc, lint, test, build.

## P5.3 Action feedback, optimistic UI, confirm/undo  [ ]   model: sonnet   depends: P5.2, P3.4
**Files:** `src/app/actions.ts`, `src/components/ListingCard.tsx`, `src/app/applied/page.tsx`, `src/app/boards/page.tsx`, `src/components/api-keys/RevokeButton.tsx`, `src/app/layout.tsx` (ToastProvider).

**Acceptance:**
- All actions return `{ok:true} | {ok:false, error:string}`.
- Forms use `useActionState`/`useFormStatus` for the pending state and a toast on error or success.
- `useOptimistic` for favorite/applied/hide/follow/pin.
- Hide and remove-from-pipeline show an Undo toast that restores the previous status.
- Delete board and revoke key go through `ConfirmDialog`.
- Add board shows validation errors inline.

**Gates:** tsc, lint, test, build.

## P5.4 Error, loading, not-found  [ ]   model: sonnet   depends: P5.2, P2.3
**Files:** `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/not-found.tsx`, and `loading.tsx` for `/`, `/boards` and the saved/settings routes. Update the existing `applied/loading.tsx` and `following/loading.tsx` to match the real layouts.

**Acceptance:**
- A DB-unavailable error renders a friendly "service temporarily unavailable" state with a Retry button.
- Skeletons match the real grids.
- Empty states use `EmptyState`; the dashboard distinguishes "no data yet" from "filters too narrow".

**Gates:** tsc, lint, test, build.

## P5.5 Component refactor  [ ]   model: sonnet   depends: P5.3
**Files:**
- `src/components/FacetSidebar.tsx` is split into `FacetSection.tsx`, `MobileFilterSheet.tsx` and `src/lib/use-facet-params.ts`. The hook is shared with `FilterBar.tsx` and `Pagination.tsx`.
- `src/components/ListingCard.tsx` is split into `FreshnessBadge.tsx`, `StatusButton.tsx` and `TagChip.tsx`.
- `timeAgo` moves to `src/lib/time.ts`.
- `src/components/JobFeed.tsx` (new) is used by `app/page.tsx`.
- `PipelineCard` reuses the card parts.

**Acceptance:**
- No visual or behaviour change, other than now using the primitives.
- Each file is 200 lines or fewer.
- Tests stay green.

**Gates:** tsc, lint, test, build.

## P5.6 Information architecture  [ ]   model: sonnet   depends: P5.5
**Files:** `src/components/AppHeader.tsx`, `src/app/layout.tsx`, `src/app/bangladesh/page.tsx` (becomes a redirect), `src/app/applied/` → `src/app/saved/` (with a redirect left at `/applied`), `src/app/settings/page.tsx` (new), `src/app/api-keys/` (moved under settings, with a redirect), `src/app/boards/` → `src/app/admin/boards/` (admin-only, with a redirect), `src/lib/bd.ts` (becomes a location preset), `src/components/ListingCard.tsx` (skill chips keep the current route).

**Acceptance:**
- Nav: Jobs · Saved · Following · Settings, plus Admin for admins.
- `/settings` holds: keywords, sound, theme (system/light/dark), API keys, and account (sign out; delete and export arrive in P6.2).
- The mobile header is at most 2 rows. The pinned locations go into a horizontal chip row with a scroll fade.
- All old URLs redirect.

**Gates:** tsc, lint, test, build.

## P5.7 Landing, onboarding, branding  [ ]   model: sonnet   depends: P5.6
**Files:**
- `src/app/(marketing)/page.tsx` or a signed-out branch of `/`, following the routing guidance in `node_modules/next/dist/docs/`;
- `src/app/onboarding/page.tsx`;
- `public/logo.svg`;
- `src/app/icon.svg` and `apple-icon.png`;
- `src/app/manifest.ts`;
- `src/app/opengraph-image.tsx`;
- per-page `metadata` in every page;
- delete the default `public/*.svg`.

**Acceptance:**
- Signed-out visitors see a landing page: value prop, a feature list, a product screenshot or illustration, and a sign-in CTA.
- The first sign-in goes to onboarding: pick skills/keywords and locations. These are saved to `user_settings`, then the user goes to a pre-filtered feed.
- Every page has a unique `<title>`.

**Gates:** tsc, lint, test, build.

## P5.8 Accessibility pass  [ ]   model: sonnet   depends: P5.6
**Files:** `src/components/MobileFilterSheet.tsx`, `FacetSection.tsx`, `ListingCard.tsx`, `StatusButton.tsx`, `TagChip.tsx`, `Pagination.tsx`, `FilterBar.tsx`, `TestBoardButton.tsx`, `CopyButton.tsx`, and the date rendering in the admin and settings pages.

**Acceptance:**
- Filter sheet: focus trap, Esc, focus return, background `inert`.
- Toggles have `aria-pressed`.
- Pin and remove-tag buttons have `aria-label`s, and the pin button is visible on touch devices (no hover-only `opacity-0`).
- Each listing has an `h3` title.
- `aria-live` on test and copy results.
- Disabled pagination is out of the tab order.
- `FilterBar` search is a real GET form that works without JS.
- Touch targets are at least 44px.
- Relative dates render on the client (no hydration drift).
- Lighthouse accessibility is ≥95 on `/`, `/saved` and `/settings`. Opus runs Lighthouse via chrome-devtools.

**Gates:** tsc, lint, test, build.

## P5.9 Visual QA  [ ]   model: sonnet   depends: P5.7, P5.8
**Goal:** every route looks right at 1280px and 375px, in light and dark.

**Process:**
- Run `pnpm dev` with the dev credentials provider.
- Take screenshots with the built-in browser.
- Fix spacing, overflow, contrast and alignment issues.
- Save the final screenshots to `docs/qa/` (gitignored), list them in the report, and include a short before/after summary.

---

## Phase 6 — Launch

## P6.1 Docs + repo hygiene  [ ]   model: sonnet   depends: P3.3
**Files:** `README.md`, `.env.example` (names only), `scripts/recon/` (move `recon*.mjs` there, or delete them), `docs/` index.

**Acceptance:** the README covers setup, env vars, migrations, seed, dev, tests, deploy (Vercel and Neon), cron and the API.

## P6.2 Privacy, terms, account deletion, export  [ ]   model: sonnet   depends: P5.6
**Files:** `src/app/(marketing)/privacy/page.tsx`, `src/app/(marketing)/terms/page.tsx`, account actions in `src/app/settings/`.

**Acceptance:**
- Delete account removes the user's rows (cascade) and signs them out, after a confirm dialog.
- Export downloads the user's state as JSON.
- The privacy and terms pages are drafts, marked "review with a lawyer".

## P6.3 E2E smoke in CI  [ ]   model: sonnet   depends: P5.9, P0.2
**Files:** `e2e/smoke.spec.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`.

**Acceptance:** with the credentials provider enabled only when `E2E=1`, the test signs in, filters, favorites a job, marks it applied, sees it in Saved, creates an API key and calls `/api/v1/jobs`.

## P6.4 Final review + PR  [ ] (Opus)
- Run `/code-review` and `/security-review` over the full branch.
- Run `pnpm audit --prod`.
- Open the PR to `main` and bind it for CI monitoring.
