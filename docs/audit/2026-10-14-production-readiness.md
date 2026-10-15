# JobRadar — Production Readiness Audit

**Date:** 2026-10-14 · **Scope:** full repo at `main` (952e947) **plus** the 23 uncommitted files / untracked `src/app/api/sync/`, `src/lib/blob-sync.ts`.

## Verdict

**Not production-ready.** The code quality is decent (typed, tested, parameterized SQL), but the app has **no authentication at all**, an **SSRF hole**, **3 critical Next.js CVEs**, and secret checks that **fail open**. These are fixable in a day or two. The bigger long-term risk is the data layer's complexity (four stores kept in sync by hand).

## Quality gates (run during audit)

| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `pnpm test` | ✅ 17 files, 197 tests pass |
| `pnpm build` | ✅ succeeds (all routes dynamic) |
| `pnpm lint` | ❌ 1 error, 2 warnings |
| `pnpm audit --prod` | ❌ 12 vulns: **3 critical**, 4 high, 4 moderate, 1 low |
| CI | ❌ none (`.github/` absent) |

## What's already good

- All SQL is parameterized; the one dynamic column list (`persistEnrichment`) uses a fixed allowlist.
- API keys are random 256-bit, stored as SHA-256 hashes, revocable, prefix-only in the UI.
- Public API query params are zod-validated with bounded sizes.
- RLS enabled on every Neon table (locks out the Data API).
- `.env*` files are gitignored and were never committed. Secrets don't reach client bundles (verified in `.next/static`).
- Good test coverage of parsers, filters, API, and the local-first layer.

---

## P0 — Blockers (fix before any public deploy)

### 1. No authentication anywhere
There is no `proxy.ts`/middleware, no session, no login. Anyone who finds the URL can:
- **Mint API keys** (`createApiKeyAction` in `src/app/api-keys/actions.ts`), which makes the API-key auth on `/api/v1/*` meaningless.
- Delete or add boards, change settings, and change listing status (`src/app/actions.ts`).
- Trigger refreshes (`POST /api/refresh`). `sameOrigin()` returns `true` when there's no `Origin` header, so `curl` passes. Each refresh costs Browserless minutes and Neon compute.
- Read `/api/db-status` and `/api/refresh/status`, which expose internal error strings.

**Fix:**
- Add a `src/proxy.ts` that gates every route except `/api/v1/*` and the cron routes. For a single-user app, the cheapest option is Vercel Deployment Protection or a signed-cookie password login. Use Auth.js if you need more than one user. (Read `node_modules/next/dist/docs/` for the Next 16 proxy API first.)
- **Also check auth inside every server action.** Server actions are POST endpoints and must not rely only on route gating.

### 2. SSRF through user-defined boards
`boardSchema.url = z.url()` accepts `http://169.254.169.254/latest/meta-data`, `file:///etc/passwd` and `javascript:` (all verified). `testBoardAction` then fetches the URL server-side and returns the result or error text. With no auth (#1), anyone can probe internal and cloud-metadata endpoints.

**Fix** (`src/app/actions.ts`, `src/lib/adapters/index.ts` `fetchText`):
- Allow only `https:` (and `http:` if you must).
- Resolve DNS and reject private, loopback, link-local and CGNAT ranges.
- Use `redirect: "manual"` and re-validate every redirect hop.
- Cap the response body size.

### 3. Cron and sync secrets fail open
In `api/refresh/cron/route.ts` and `api/sync/blob/route.ts`, the code checks `if (secret && header !== ...)`. If `CRON_SECRET` is unset, the endpoint is wide open.

**Fix:** if the secret is missing, return 500. Compare with `crypto.timingSafeEqual`.

### 4. Vulnerable Next.js and sharp
`next@16.3.1` has 3 critical advisories (RCE in image optimization and `next/og`), 1 high (SSRF in image optimization) and 5 moderate/low. `sharp` (pulled in transitively) has 2 highs.

**Fix:** `pnpm up next@^16.3.8 eslint-config-next@^16.3.8` and refresh the lockfile so `sharp` resolves to ≥0.35.5. Re-run `pnpm audit --prod` until it's clean.

### 5. Large uncommitted change set on `main`, no CI
950+ lines across 23 modified files and 5 untracked files (the Blob sync feature) exist only in the working tree.

**Fix:** move them to a feature branch and commit. Add a GitHub Actions workflow that runs `tsc`, `lint`, `test`, `build` and `pnpm audit --prod --audit-level=high` on every PR.

---

## P1 — High (fix before relying on it)

### 6. Public API loads the full table before checking the key
`/api/v1/jobs`, `/jobs/[id]` and `/meta` call `loadListingsPoolSafe()` **before** `requireAuth`. Every unauthenticated request triggers a full listings scan. That makes the endpoint a cheap DoS and a source of Neon egress cost.

**Fix:** authenticate first, then load. Add per-key and per-IP rate limiting (e.g. Upstash Ratelimit or Vercel WAF rules).

### 7. API auth fails open during DB outages
`requireAuth` in `src/lib/api/jobs.ts` lets any request through while the circuit breaker is `down`. The justification ("listings are public on the dashboard anyway") stops holding once #1 is fixed.

**Fix:** return 503 instead. Optionally keep a short-TTL in-memory cache of recently validated key hashes.

### 8. Secrets are baked into build output
The `env:` block in `next.config.ts` inlines `DATABASE_URL`, `CRON_SECRET`, `REED_API_KEY` and `BROWSERLESS_WS_URL` into the server bundles. Verified: 3, 2 and 10 files under `.next/server` contain them in plaintext. Rotating a secret then needs a rebuild. If a client component ever references one of these variables, the secret ships to browsers.

**Fix:** delete the `env:` block and set the values as Vercel environment variables (they're read at runtime). Then **rotate** the DB password, cron secret and Browserless token, because they've been in build artifacts.

### 9. Data layer is too complex for its job
Reads and writes route across Neon, on-device SQLite, a local outbox and a Blob op log. Postgres SQL is translated to SQLite with regexes (`src/db/translate.ts`), and there's a circuit breaker with persisted state. That's ~2,400 lines (`db/*`, `blob-sync.ts`) for a CRUD app. Specific risks:
- **Silent data loss on serverless.** Offline writes are acknowledged to the user, but they only survive if `flushBlobOps()` succeeds, and every caller swallows that error (`catch {}`).
- **Refresh single-flight isn't atomic.** `beginTrackedRun` reads `app_settings`, then writes it. Two instances can both start a run.
- **Outbox replay ordering vs. remote writes.** This is hard to reason about. Natural-key normalization helps, but conflicting edits made while offline are last-writer-wins, without the user knowing.

**Recommendation:** on Vercel, run Neon-only (`LOCAL_FIRST` is already off there) and **remove the Blob op-log path**. Show a clear "database unavailable, try again" state instead of acknowledging writes that may vanish. Keep local-first only if you really ship a self-hosted or desktop mode. Use `pg_try_advisory_lock` (or `insert ... on conflict do nothing` on a lock row) for the refresh single-flight.

### 10. No schema migrations
DDL lives in `ensureSchema()` as `create table if not exists`, so adding or changing a column on an existing DB never happens. Every cold instance also re-runs the DDL, RLS and seed.

**Fix:** adopt a migration tool (drizzle-kit, node-pg-migrate or Atlas) and run it in the deploy step, not at request time. While you're there:
- Use `timestamptz` for dates (currently text).
- Use `boolean` (currently int).
- Use `jsonb` for tags and skills (currently text).
- Add an index on `coalesce(posted_at, fetched_at)`.

### 11. Every page view loads the whole listings table
`src/app/page.tsx`, the other pages and the API all `select` every listing, then filter, facet and paginate in JS (`buildJobView`). That's fine for a few thousand rows, but cost and latency grow linearly.

**Fix:** push filters and pagination into SQL. Use Postgres full-text search (`tsvector` + GIN) for `q`. Compute facet counts with `group by` queries or a materialized view refreshed after each refresh run.

### 12. Refresh doesn't fit in one 60s function
`executeRun` fetches every board concurrently (including Browserless detail rendering) inside `after()` with `maxDuration = 60`. Long runs get killed mid-way. The 5-minute "stale run" heuristic hides this rather than fixing it.

**Fix:** fan out one job per board (Vercel Queues/QStash, or a cron that processes N stale boards per tick). Or raise `maxDuration` (Fluid compute allows much longer). Record per-board failures for alerting.

### 13. Ingested listing URLs aren't validated
`listing.url` from third-party feeds is rendered as `<a href>` in `ListingCard.tsx` and `applied/page.tsx`. React 19 blocks `javascript:` URLs, but don't rely on that.

**Fix:** at ingest (`normalize.ts`), keep only `http(s)` URLs.

---

## P2 — Medium (polish for a real production service)

| # | Issue | Fix |
|---|---|---|
| 14 | Lint error: `Date.now()` during render in `RefreshStatusBar.tsx:50`; unused `q` in `actions.ts` and `parseNextJobzRsc` in `adapters/index.ts` | Move the freshness calculation into state or an effect, and remove the unused imports. |
| 15 | No `error.tsx`, `global-error.tsx` or `not-found.tsx`. Server actions fail silently: `addBoardAction` swallows duplicate-name and other errors, and `catch {}` is widespread | Add error boundaries. Return `{error}` state from actions and show it in forms. Log every swallowed error. |
| 16 | Observability is `console.*` only | Add Sentry (or similar) plus structured logs. Alert on breaker → down, refresh-run failures and cron non-2xx. |
| 17 | No security headers | Add `headers()` in `next.config.ts`: CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS. |
| 18 | Status endpoints leak internals (`lastError` strings) | Put them behind auth (#1) or redact. |
| 19 | `playwright` (full package, ~browser downloads) is a prod dependency, even though serverless uses Browserless over CDP | Switch to `playwright-core` and keep full `playwright` as a dev dependency for local scraping. |
| 20 | Scrapers spoof a desktop Chrome UA and ignore robots.txt | Check each source's ToS. Use an honest UA with contact info and honor robots.txt. Prefer official APIs/RSS. This is a legal and reputational risk once the app is public. |
| 21 | Repo hygiene: `recon*.mjs` scratch scripts committed at root; README is the create-next-app template; no `.env.example` | Move the scripts to `scripts/` or delete them. Write a real README (setup, env vars, deploy, cron). Add `.env.example` with variable names only. |
| 22 | Test gaps: nothing covers server actions, authorization or the SSRF guard; no e2e tests | Add tests for the auth gate and URL validator, and a Playwright smoke test (load dashboard, add board, refresh). |
| 23 | Vitest config loads as CJS (warning) | Rename to `vitest.config.mts` or set `"type": "module"`. |
| 24 | API CORS is `*` | Acceptable for a bearer-token API without cookies. Keep it that way; never add cookie auth to `/api/v1`. |

---

## Suggested order of work

1. **Day 1 (security):** #5 branch + CI → #4 upgrade → #1 auth (proxy + per-action checks) → #2 SSRF guard → #3 fail-closed secrets → #8 remove `env:` block and rotate secrets.
2. **Day 2 (API hardening):** #6 auth-before-load + rate limit → #7 fail closed → #13 URL validation → #14, #15, #17.
3. **Week 2 (reliability):** #10 migrations → #9 simplify the data layer → #12 per-board refresh jobs → #16 observability.
4. **As data grows:** #11 SQL-side filtering and full-text search.
