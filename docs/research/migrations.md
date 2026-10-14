# P2.1 Migration runner: simplest robust approach for raw SQL with postgres.js on Neon and Vercel

**Decision / answer:** Keep the leaning. Use `db/migrations/NNN_name.sql` files and a ~60-line `scripts/migrate.ts` that uses postgres.js directly. It creates `schema_migrations(name text primary key, applied_at timestamptz default now())`, takes `pg_advisory_xact_lock` in one outer `sql.begin`, and applies each unapplied file with `tx.unsafe(fileText)` (no params, so multi-statement is allowed). Run it against the **direct** Neon URL (`DATABASE_URL_UNPOOLED`) via `pnpm db:migrate`, chained before `next build` in a Vercel build command override. Never run it on the pooled URL for DDL.

## Details

- **Pooled vs direct:** Neon's `-pooler` endpoint is PgBouncer in transaction mode. Session-level advisory locks, `SET`, `PREPARE`, and `LISTEN` are not supported there. Neon's guide lists "Schema migrations" under direct connections. Use `DATABASE_URL_UNPOOLED` for migrations. The app keeps `DATABASE_URL` (pooled), as in `src/db/remote.ts:getDb()` with `prepare: false`.
- **Lock:** `pg_advisory_xact_lock` is transaction-scoped, so it is released on commit or rollback and cannot leak. Two concurrent Vercel builds serialize on it. Because Postgres DDL is transactional, one outer transaction gives an all-or-nothing run.
- **Sketch** (`scripts/migrate.ts`, run with `node --env-file=.env.local scripts/migrate.ts`):

```ts
import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set");
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const dir = join(import.meta.dirname, "..", "db", "migrations");
const LOCK_KEY = 74_201; // any fixed bigint, constant for this project

try {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK_KEY})`;
    await tx`create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now())`;
    const done = new Set(
      (await tx<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      console.log(`applying ${f}`);
      await tx.unsafe(await readFile(join(dir, f), "utf8"));
      await tx`insert into schema_migrations (name) values (${f})`;
    }
  });
} finally {
  await sql.end();
}
```

- **Package scripts:** `"db:migrate": "node --env-file-if-exists=.env.local scripts/migrate.ts"` (Node 24 has `--env-file-if-exists`; verify on Node 24.x before relying on it). Vercel build: `pnpm db:migrate && pnpm build`, set via Dashboard → Settings → Build and Deployment → Override. `vercel.json` has no `buildCommand` today.
- **Running TS:** no `tsx` in `node_modules/.bin` or devDependencies. Use Node native type stripping. Node 24 has it on by default and it is stable as of v24.12.0 (`--no-strip-types` disables it). Restrictions: no `enum`, no runtime `namespace`, no parameter properties, and `import type` must be explicit. Relative imports need `.ts` extensions. tsconfig `paths` aliases are NOT resolved, so `scripts/*` must not import `@/…` (e.g. `@/db/seed`). Keep the seed in a separate `scripts/seed.ts` that uses relative imports, or inline the data. CI uses Node 24 (`.github/workflows/ci.yml`). The local machine runs Node v26.10.0.
- **Baseline contents (`001_baseline.sql`), from `ensureSchema()` in `src/db/remote.ts`:**
  - Tables: `boards`, `listings` (with `check (status in ('new','favorite','applied','hidden'))` and `unique (board_id, external_id)`), `app_settings`, `followed_companies`, `pinned_countries`, `api_keys`.
  - Indexes: `idx_listings_board`, `idx_listings_status`, `uq_followed_companies_name` on `lower(name)`, `uq_pinned_countries_name` on `lower(name)`. `api_keys.key_hash` is unique.
  - RLS: `alter table … enable row level security` on all six tables above. No policies are created, so the Data API is locked out and the table owner (the app's postgres role) keeps access.
  - The `boards` seed (`insert … select from unnest(...) on conflict (name) do nothing`) is data, not DDL. Move it to `scripts/seed.ts`.
- **Callers of the runtime DDL:**
  - `ensureSchema()` is called only from `ensureRemoteReady()` in `src/db/remote.ts`. That function is used by `remoteQuery`, `remoteRun`, and `remoteRunReturning`. Those are used by `src/db/sync.ts`, `src/lib/api/keys-store.ts`, and `src/db/index.ts` (re-export of `getDb`).
  - A second, duplicate DDL path is `ensureRemoteApiKeysSchema()` in `src/lib/api/keys-store.ts:71`. It runs `API_KEYS_DDL` and `enable row level security` before five call sites (lines 148, 195, 210, 253, 271). P2.2 must remove it too, or the app will still issue DDL at runtime. The `api_keys` DDL in `keys-store.ts` duplicates the baseline and must be deleted there, not kept in sync.
- **Preview branches:** the Neon Vercel integration creates a Neon branch per Vercel Preview Deployment (webhook, branch named `preview/<git-branch>`). Its connection variables override the Preview env vars for that deployment. The integration exposes `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct). Each preview branch is a copy of its parent, so running `db:migrate` in the Preview build migrates only that branch. The integration must have Preview enabled. Verify that `DATABASE_URL_UNPOOLED` is in the Production and Preview scopes; this is not confirmed from the page.
- **Expand/contract:** migrations run before the deploy goes live. A failed deploy leaves the schema ahead of the code. Keep migrations backward-compatible with the previous release.
- **Avoid:** `create index concurrently` (cannot run inside a transaction). Avoid `begin;`/`commit;` inside migration files.
- **Local DB state:** `.env.local` has `DATABASE_URL` on a `-pooler` host. It has no `DATABASE_URL_UNPOOLED`, so the staging run needs that variable added (user action, alongside `STAGING_DATABASE_URL`).

## Gotchas

- `sql.unsafe(text)` without params uses the simple protocol, which allows multiple statements. With params it does not. Migration files must therefore be run with no params.
- `max: 1` plus `sql.begin` is safe. Without `begin`, separate statements can land on different connections.
- The advisory key is project-global, so pick one constant and do not reuse it elsewhere.
- Node 24 `--env-file-if-exists`: unverified on the exact 24.x patch used by Vercel. Vercel build runtime Node version: unverified.
- The Neon docs pages do not show a publication date. Facts were checked on 2026-10-14.

## Sources

- `/Users/abid/Projects/jobradar/src/db/remote.ts` (lines 44–160) — ensureSchema DDL, RLS statements, seed, and the `ensureRemoteReady` caller chain.
- `/Users/abid/Projects/jobradar/src/lib/api/keys-store.ts` (lines 51–81, 148–271) — `API_KEYS_DDL` and `ensureRemoteApiKeysSchema` call sites.
- `/Users/abid/Projects/jobradar/package.json` — no `tsx`, no `ts-node`, no db scripts; `packageManager` pnpm@11.17.0.
- `/Users/abid/Projects/jobradar/vercel.json` — crons only, no `buildCommand`.
- `/Users/abid/Projects/jobradar/.github/workflows/ci.yml` — Node 24 in CI.
- `/Users/abid/Projects/jobradar/docs/plan/production-readiness.md` (P2.1, P2.2) — the spec for this task.
- https://neon.com/docs/connect/connection-pooling (fetched 2026-10-14) — transaction-mode limits; migrations recommended on direct connection.
- https://neon.com/docs/guides/vercel-managed-integration (fetched 2026-10-14) — preview branch per deployment, `DATABASE_URL_UNPOOLED`, Vercel build override example.
- Context7 `/porsager/postgres` (queried 2026-10-14) — `sql.begin` semantics, `sql.reserve`, `UNSAFE_TRANSACTION` rule, connection options.
- https://nodejs.org/api/typescript.html (fetched 2026-10-14) — type stripping default-on in v23.6/v22.18, stable v24.12/v25.2, restrictions, `.ts` extension rule, no tsconfig paths.
