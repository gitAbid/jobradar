# Local-first data layer (on-device cache + Neon sync)

The app never depends on Neon being reachable. An on-device SQLite mirror
(built on `node:sqlite`, zero native dependencies) serves reads and absorbs
writes; Neon is the sync target and long-term source of truth.

## Routing policy

All data access funnels through `q` / `qOne` / `run` in `src/db/index.ts`,
so the policy lives in one place:

| Path  | Order                                                                                                                                  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| reads | memory cache (10s TTL) → on-device SQLite → (hydration/catch-up from Neon, throttled to once per 2 min while Neon is healthy)          |
| writes| on-device SQLite immediately → write-through to Neon → if Neon fails, the statement is queued in a local outbox and replayed FIFO later |

A circuit breaker (`src/db/remote-health.ts`) trips on connection/limit
failures (timeouts, connection refused, "too many connections", quota /
compute-suspend errors) and re-probes after a 15s→5min backoff. While the
breaker is open the app keeps serving from the mirror with zero network
latency; queued writes replay when the probe succeeds. SQL bugs are never
masked — they still throw like the direct driver did.

## Modules

- `src/db/local-store.ts` — the SQLite mirror: schema, seed, outbox queue,
  snapshot ingestion, meta. File lives at `.jobradar/local.db` (override with
  `LOCAL_DB_PATH`; falls back to `/tmp` on read-only filesystems, which is
  what happens on serverless).
- `src/db/remote.ts` — Neon connection, `ensureSchema`, remote executors with
  a 6s timeout budget, plus the test harness seam.
- `src/db/remote-health.ts` — circuit breaker.
- `src/db/sync.ts` — hydration, outbox drain, recovery, background tick,
  `/api/db-status` payload.
- `src/db/translate.ts` — Postgres→SQLite translation (`$n` params, `::type`
  casts) and the error classifier.

## Consistency model

- **Listings/boards rows keep their remote ids.** Hydration wipes the local
  mirror and copies rows with their Postgres ids, so anything referencing a
  listing id (UI forms, queued statements) stays meaningful.
- **Listing mutations queue by business key.** `update listings … where id = $n`
  statements are normalized at enqueue time to `(board_id, external_id)` ops
  and re-resolved against the remote id at replay — immune to id drift.
- **User-owned tables merge by natural key** on hydration
  (`app_settings` by key, followed companies / pinned countries by name,
  `api_keys` by hash), so entries added offline survive.
- **The outbox drains before hydration**, so locally-made changes always win
  on the remote before the mirror is refreshed from it.

## Known edge cases

- A store that was seeded entirely offline (remote never answered once) has
  locally-assigned board ids that differ from the remote's. On recovery, the
  outbox replays may drop those rows (logged, FK mismatch) — the affected
  listings simply re-fetch on the next refresh cycle. Normal operation
  (hydrated at least once) is unaffected.
- On serverless the mirror file is per-instance `/tmp` state: each warm
  instance keeps its own copy, refreshed from Neon at most every 2 minutes
  per request. Writes always go through to Neon immediately (or queue on
  failure), so cross-instance staleness is bounded by that window.
- Local file persistence needs `node:sqlite` (Node ≥ 22.5). Without it the
  layer degrades to the old remote-direct behavior with a warning log.

## Operations

- `GET /api/db-status` — mode, remote state, breaker detail, outbox depth,
  mirror counts and last sync time.
- The header shows an amber "Local mode" pill whenever reads/writes are being
  served without the remote.
- `LOCAL_FIRST=0` disables the layer entirely (plain remote-direct behavior).
- `LOCAL_DB_PATH=/some/file.db` relocates the mirror.
