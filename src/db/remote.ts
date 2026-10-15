import postgres from "postgres";
import { withTimeout } from "@/db/errors";
import { approxBytes, recordQuery } from "@/db/usage";

// ── Postgres connection (Neon; singleton survives HMR via globalThis) ──

declare const globalThis: {
  __jobradarSql?: postgres.Sql;
  __jobradarRemoteHarness?: RemoteHarness;
};

/** Per-statement time budget; a slow Neon call rejects instead of hanging the request. */
const REMOTE_TIMEOUT_MS = 6_000;

export function getDb(): postgres.Sql {
  if (!globalThis.__jobradarSql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set — point it at the Neon pooled connection string",
      );
    }
    globalThis.__jobradarSql = postgres(url, {
      // required behind Neon's connection pooler (pgbouncer-style)
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return globalThis.__jobradarSql;
}

// ── Test harness ───────────────────────────────────────────────────────────
//
// Code that talks to Postgres must be testable without a live database: tests
// install a fake executor and every remote call below routes through it.
// Production never sets it.

export interface RemoteHarness {
  query: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
  run: (sql: string, params: unknown[]) => Promise<number>;
}

export function setRemoteHarness(harness: RemoteHarness | null): void {
  globalThis.__jobradarRemoteHarness = harness ?? undefined;
}

export function getRemoteHarness(): RemoteHarness | undefined {
  return globalThis.__jobradarRemoteHarness;
}

/** Count every real remote call (failures too); measure bytes for row results. */
async function counted<R>(p: Promise<R>, measure = true): Promise<R> {
  try {
    const r = await p;
    recordQuery(measure ? approxBytes(r) : 0);
    return r;
  } catch (e) {
    recordQuery(0);
    throw e;
  }
}

/** Remote SELECT; resolves to rows. Rejects if it exceeds REMOTE_TIMEOUT_MS. */
export async function remoteQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const harness = getRemoteHarness();
  if (harness) return (await harness.query(sql, params)) as T[];
  const rows = await counted(
    withTimeout(
      getDb().unsafe(sql, params as never[]) as Promise<T[]>,
      REMOTE_TIMEOUT_MS,
      "remote query",
    ) as Promise<T[]>,
  );
  return rows;
}

/** Remote mutation; resolves to affected-row count. */
export async function remoteRun(sql: string, params: unknown[] = []): Promise<number> {
  const harness = getRemoteHarness();
  if (harness) return harness.run(sql, params);
  const result = await counted(
    withTimeout(
      getDb().unsafe(sql, params as never[]),
      REMOTE_TIMEOUT_MS,
      "remote write",
    ),
    false,
  );
  return result.count;
}

/** Remote mutation that returns rows (INSERT ... RETURNING). */
export async function remoteRunReturning<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const harness = getRemoteHarness();
  if (harness) {
    const rows = await harness.query(sql, params);
    return rows as T[];
  }
  const rows = await counted(
    withTimeout(
      getDb().unsafe(sql, params as never[]) as Promise<T[]>,
      REMOTE_TIMEOUT_MS,
      "remote write",
    ) as Promise<T[]>,
  );
  return rows;
}

/** Cheap liveness probe used by the health endpoint. */
export async function probeRemote(): Promise<boolean> {
  await remoteQuery("select 1 as ok");
  return true;
}
