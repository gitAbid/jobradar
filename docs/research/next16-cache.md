# Next 16 Cache Components for a shared listings cache (card P2.0b)
**Decision / answer:** Enable `cacheComponents: true` and cache the shared listing pool with `'use cache'` plus `cacheTag`/`cacheLife`, but use `'use cache: remote'` for cross-request sharing on Vercel, because the default in-memory `use cache` store does not persist across serverless requests. Remote caching needs no config locally (falls back to in-memory LRU), but for shared storage in production a `cacheHandlers.remote` backend is needed on self-hosted; on Vercel the docs say the platform "should typically provide this automatically" (which backend is unverified from local docs). Cache low-cardinality args (source/keyword set), filter per-user in memory, and never read cookies/searchParams inside cached scope. Installed version: next 16.3.8.

## Details
- **Config:** `next.config.ts` → `cacheComponents: true`. Requires Node runtime (edge unsupported). Also makes PPR the default; `experimental.ppr` / `experimental_ppr` are removed.
- **Imports:** `import { cacheLife, cacheTag, revalidateTag, updateTag } from "next/cache"`; `import { connection } from "next/server"`.
- **Shared listing pool (sketch, adapt to `src/lib/`):**
  ```ts
  import { cacheLife, cacheTag } from "next/cache";
  export async function getListingPool(sourceKey: string) {
    "use cache";                       // or "use cache: remote" (see below)
    cacheLife("minutes");              // always set explicitly
    cacheTag("listings", `listings:${sourceKey}`);
    return loadPoolRows(sourceKey);    // postgres.js query; args must be serializable
  }
  ```
  Writers: `updateTag("listings")` in a Server Action (read-your-writes); `revalidateTag("listings", "max")` in a Route Handler (stale-while-revalidate). Two-arg form is required (single-arg is deprecated).
- **`'use cache` vs `'use cache: remote'`:** `use cache` = default handler, per-process in-memory LRU (default ~50MB, `cacheMaxMemorySize`); persists across requests on self-hosted `next start`, but on serverless "cache entries typically don't persist across requests". `use cache: remote` = `remote` handler, shared across instances when a durable `cacheHandlers.remote` is configured; without config it uses the same in-memory LRU. Neither survives a deploy (cache key includes buildId/deploymentId). `use cache: private` is per-client and cannot nest inside remote.
- **cacheLife:** built-ins `default` (5m stale / 15m revalidate / never expire), `seconds`, `minutes` (5m/1m/1h), `hours`, `days`, `weeks`, `max`. Custom: define in `next.config.ts` under `cacheLife: { name: { stale, revalidate, expire } }` (seconds; expire > revalidate); use `cacheLife("name")`. Inline `cacheLife({...})` also allowed. Call once per invocation, inside the cached scope (not at module scope).
- **Where tag APIs may be called:** `updateTag`: Server Actions only (throws elsewhere). `revalidateTag(tag, profile)`: Server Actions and Route Handlers; not Client Components or Proxy. `revalidatePath`: still supported in Server Actions/Route Handlers.
- **Arguments/cache key:** key = buildId (or deploymentId) + secure hash of function location/signature + serialized args + captured closure variables (+HMR hash in dev). Args/returns must be serializable: primitives, plain objects, arrays, Date, Map, Set, TypedArray, ArrayBuffer, React elements (pass-through only). Not allowed: class instances, functions (except pass-through), symbols, WeakMap/WeakSet, URL. Uncached Promises passed in cause prerender hang.
- **Per-user data:** do not read `cookies()`/`headers()`/`searchParams` inside a `use cache` scope (fails with `next-request-in-use-cache`, possibly only at runtime under `next start`). Read in the uncached caller and pass only shared dimensions (e.g. `sourceKey`, language) to the cached function; apply per-user filters in memory. Including a `userId` argument creates one entry per user. Use `use cache: private` only if compliance demands.
- **Cache hit observation:** (a) `NEXT_PRIVATE_DEBUG_CACHE=1 pnpm start` logs ISR/cache hits and misses (also works with dev per docs); (b) dev console logs from cached functions are replayed with a `Cache` prefix; (c) most reliable for tests: wrap the DB call with a counter and assert it runs once across two calls. Note: `draftMode` enabled bypasses caches.
- **Route segment configs:** `dynamic`, `dynamicParams`, `revalidate`, `fetchCache` are removed / error when cacheComponents is on. `runtime = "nodejs"` is fine (default); `"edge"` is unsupported. `maxDuration` is not listed as removed.

## Required file changes (grep of `src/app`)
- Remove `export const dynamic = "force-dynamic"` (must be deleted, will error) and keep `runtime = "nodejs"` (optional to remove):
  - `src/app/api/v1/meta/route.ts`, `src/app/api/v1/jobs/route.ts`, `src/app/api/v1/jobs/[id]/route.ts`
  - `src/app/api/refresh/route.ts`, `src/app/api/refresh/status/route.ts`, `src/app/api/refresh/cron/route.ts`
  - `src/app/api/db-status/route.ts`, `src/app/api/sync/blob/route.ts`
- `export const revalidate`, `fetchCache`, `dynamicParams`: none found in `src/`.
- `export const maxDuration = 60` in `src/app/page.tsx`, `applied/page.tsx`, `following/page.tsx`, `bangladesh/page.tsx`, `api/refresh/route.ts`, `api/refresh/cron/route.ts`, `api/sync/blob/route.ts`: keep.
- `connection()` calls (keep; they are the documented request-time opt-out): `src/app/layout.tsx` (lines 20, 63), `src/app/page.tsx`, `src/app/applied/page.tsx`, `src/app/boards/page.tsx`, `src/app/following/page.tsx`, `src/app/bangladesh/page.tsx`, `src/app/api-keys/page.tsx`.
- Route handlers with no `request` arg that touch `new Date()`/`Date.now()` during prerender need `await connection()` first (sync IO fails prerender): `src/app/api/db-status/route.ts` (`GET()`), `src/app/api/refresh/status/route.ts` (`GET()`).
- No `use cache`, `unstable_cache`, `revalidateTag` exist in `src/` yet. `src/app/actions.ts` and `src/app/api-keys/actions.ts` use `revalidatePath` only; they will not purge tagged `use cache` entries, so add `updateTag("listings")` alongside.

## Gotchas
- `dynamic`/`revalidate` removal is an error in dev and build, not a warning.
- Dev "insights" (e.g. `blocking-prerender-runtime`) appear in overlay/log only; default `validationLevel` is `'warning'`. Check with `next build`.
- A short-lived `use cache` nested in one without explicit `cacheLife` fails prerender.
- High-cardinality args (search filters, per-user ids) destroy hit rate; cache the pool per source and filter in memory (doc example).
- `revalidateTag(tag, "max")` serves stale data until a request triggers revalidation; `updateTag` expires immediately but is Server-Action-only.
- Calling `revalidateTag` from background work after the response (`after()` or un-awaited promise) is not documented. Unverified; await it inside the Route Handler.
- `updateTag` in a Route Handler throws. Use `revalidateTag` there.
- `cacheLife`/`cacheTag` cannot be called at module scope.
- Remote cache entries do not survive deploys.
- Local dev: `use cache: remote` works with defaults (in-memory). For shared persistence, a `cacheHandlers` backend is needed on self-hosted; Vercel backend unverified.

## Sources
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.md` — enabling flag, Node runtime, PPR default
- `.../02-guides/migrating-to-cache-components.md` — dynamic/revalidate/fetchCache error, connection(), Suspense, runtime edge, GET handlers, `instant` validation
- `.../03-api-reference/01-directives/use-cache.md` — keys, serialization, constraints, runtime caching table, debug env var, build hang
- `.../03-api-reference/01-directives/use-cache-remote.md` — remote vs cache semantics, nesting, cache-key guidance, example
- `.../03-api-reference/05-config/01-next-config-js/cacheHandlers.md` — default in-memory handler for `remote`, handler config
- `.../03-api-reference/05-config/01-next-config-js/cacheLife.md` and `.../04-functions/cacheLife.md` — custom/built-in profiles, values
- `.../03-api-reference/04-functions/cacheTag.md`, `revalidateTag.md`, `updateTag.md`, `revalidatePath.md` — API and call contexts
- `.../04-functions/connection.md` — request-time opt-out
- `.../04-functions/after.md` — after() semantics; no revalidate contract
- `.../02-guides/self-hosting.md` — default cache memory 50MB, shared cache via cacheHandlers
- `.../02-guides/incremental-static-regeneration.md` (~line 568) — NEXT_PRIVATE_DEBUG_CACHE
- `.../03-api-reference/03-file-conventions/02-route-segment-config/index.md`, `runtime.md` — removed configs
- Repo: `src/app/**/route.ts`, `src/app/**/page.tsx`, `src/app/layout.tsx`, `src/app/actions.ts`; `src/lib/adapters/index.ts` (uses `VERCEL === "1"`)
