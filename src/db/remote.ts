import postgres from "postgres";
import { withTimeout } from "@/db/translate";

// ── Postgres connection (Neon; singleton survives HMR via globalThis) ──

declare const globalThis: {
  __jobradarSql?: postgres.Sql;
  __jobradarRemoteHarness?: RemoteHarness;
};

/** Remote operation time budget — fallback must be fast, not hang. */
export const REMOTE_TIMEOUT_MS = 6_000;

export function isRemoteConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

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
// The local-first layer must be testable without a live Postgres: tests
// install a fake remote executor and every remote call below routes through
// it. Production never sets it.

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

/** Remote SELECT; resolves to rows. Times out as a connection failure. */
export async function remoteQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const harness = getRemoteHarness();
  if (harness) return (await harness.query(sql, params)) as T[];
  return (await withTimeout(
    getDb().unsafe(sql, params as never[]) as Promise<T[]>,
    REMOTE_TIMEOUT_MS,
    "remote query",
  )) as T[];
}

/** Remote mutation; resolves to affected-row count. */
export async function remoteRun(sql: string, params: unknown[] = []): Promise<number> {
  const harness = getRemoteHarness();
  if (harness) return harness.run(sql, params);
  const result = await withTimeout(
    getDb().unsafe(sql, params as never[]),
    REMOTE_TIMEOUT_MS,
    "remote write",
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
  return (await withTimeout(
    getDb().unsafe(sql, params as never[]) as Promise<T[]>,
    REMOTE_TIMEOUT_MS,
    "remote write",
  )) as T[];
}

/** Cheap liveness probe used by the circuit breaker. */
export async function probeRemote(): Promise<boolean> {
  await remoteQuery("select 1 as ok");
  return true;
}
