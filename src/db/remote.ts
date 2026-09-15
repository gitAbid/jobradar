import postgres from "postgres";
import { SEED_BOARDS } from "@/db/seed";
import { withTimeout } from "@/db/translate";

// ── Postgres connection (Neon; singleton survives HMR via globalThis) ──

declare const globalThis: {
  __jobradarSql?: postgres.Sql;
  __jobradarSchemaReady?: Promise<void>;
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

/**
 * Schema + seed, applied once per process before the first remote query. The
 * DDL is idempotent, so concurrent instances racing on a fresh database
 * converge.
 */
export function ensureSchema(): Promise<void> {
  if (!globalThis.__jobradarSchemaReady) {
    globalThis.__jobradarSchemaReady = (async () => {
      const db = getDb();
      await db.unsafe(`
        create table if not exists boards (
          id                   integer generated always as identity primary key,
          name                 text not null unique,
          type                 text not null,
          url                  text not null,
          enabled              integer not null default 1,
          filter_keywords      text not null default '[]',
          last_fetched_at      text,
          last_status          text,
          fetch_interval_hours integer not null default 4
        );

        create table if not exists listings (
          id               integer generated always as identity primary key,
          board_id         integer not null references boards(id) on delete cascade,
          external_id      text not null,
          title            text not null,
          company          text not null default '',
          location         text not null default '',
          is_remote        integer not null default 0,
          visa_sponsorship integer not null default 0,
          remote_scope     text,
          tags             text not null default '[]',
          skills           text not null default '[]',
          url              text not null default '',
          posted_at        text,
          deadline         text,
          fetched_at       text not null,
          status           text not null default 'new'
                           check (status in ('new','favorite','applied','hidden')),
          user_tags        text not null default '[]',
          search_text      text not null default '',
          description      text not null default '',
          unique (board_id, external_id)
        );
        create index if not exists idx_listings_board on listings(board_id);
        create index if not exists idx_listings_status on listings(status);

        create table if not exists app_settings (
          key   text primary key,
          value text not null
        );

        create table if not exists followed_companies (
          id         integer generated always as identity primary key,
          name       text not null,
          created_at text not null
        );
        create unique index if not exists uq_followed_companies_name
          on followed_companies (lower(name));

        create table if not exists pinned_countries (
          id         integer generated always as identity primary key,
          name       text not null,
          created_at text not null
        );
        create unique index if not exists uq_pinned_countries_name
          on pinned_countries (lower(name));
      `);

      // Tables live in the API-exposed `public` schema; RLS with no policies
      // locks the Data API out while the postgres-role app connection
      // (table owner) keeps full access.
      await db.unsafe(`
        alter table boards enable row level security;
        alter table listings enable row level security;
        alter table app_settings enable row level security;
        alter table followed_companies enable row level security;
        alter table pinned_countries enable row level security;
      `);

      await db.unsafe(
        `insert into boards (name, type, url, filter_keywords, enabled)
         select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[])
         on conflict (name) do nothing`,
        [
          SEED_BOARDS.map((b) => b.name),
          SEED_BOARDS.map((b) => b.type),
          SEED_BOARDS.map((b) => b.url),
          SEED_BOARDS.map((b) => JSON.stringify(b.keywords)),
          SEED_BOARDS.map((b) => (b.enabled === false ? 0 : 1)),
        ] as never[],
      );
    })().catch((err) => {
      // allow a later request to retry a failed init (e.g. transient DNS)
      globalThis.__jobradarSchemaReady = undefined;
      throw err;
    });
  }
  return globalThis.__jobradarSchemaReady;
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

async function ensureRemoteReady(): Promise<void> {
  const harness = getRemoteHarness();
  if (harness) return; // fake remote has a fixed schema
  await ensureSchema();
}

/** Remote SELECT; resolves to rows. Times out as a connection failure. */
export async function remoteQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ensureRemoteReady();
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
  await ensureRemoteReady();
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
  await ensureRemoteReady();
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
