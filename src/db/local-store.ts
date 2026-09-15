import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hasReturningClause, isReadStatement, translateToSqlite } from "@/db/translate";
import { SEED_BOARDS } from "@/db/seed";

// ── On-device SQLite store (node:sqlite, zero native deps) ────────────────
//
// Primary read path and offline authority for jobradar. `node:sqlite` is
// loaded dynamically: environments without it (older serverless runtimes)
// degrade gracefully to remote-direct mode instead of crashing the module.

type SqliteDatabase = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number | bigint };
    all: (...params: unknown[]) => Record<string, unknown>[];
  };
  close: () => void;
};

export interface Snapshot {
  boards: Record<string, unknown>[];
  listings: Record<string, unknown>[];
  appSettings: Array<{ key: string; value: string }>;
  followedCompanies: Array<{ name: string; created_at: string }>;
  pinnedCountries: Array<{ name: string; created_at: string }>;
  apiKeys: Record<string, unknown>[];
}

export interface QueueEntry {
  id: number;
  /** "sql" replays verbatim; "op" is a normalized replay-safe op (outbox.ts). */
  kind: "sql" | "op";
  payload: unknown;
}

export function localDbPathFromEnv(): string {
  const custom = process.env.LOCAL_DB_PATH;
  if (custom) {
    try {
      mkdirSync(path.dirname(custom), { recursive: true });
    } catch {
      // fall through to the open() failure path
    }
    return custom;
  }
  const dir = path.join(process.cwd(), ".jobradar");
  try {
    mkdirSync(dir, { recursive: true });
    return path.join(dir, "local.db");
  } catch {
    // read-only cwd (some serverless images) — /tmp is the documented fallback
    return path.join(tmpdir(), "jobradar-local.db");
  }
}

const DDL = `
  create table if not exists boards (
    id                   integer primary key autoincrement,
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
    id               integer primary key autoincrement,
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
    id         integer primary key autoincrement,
    name       text not null,
    created_at text not null
  );
  create unique index if not exists uq_followed_companies_name
    on followed_companies (lower(name));
  create table if not exists pinned_countries (
    id         integer primary key autoincrement,
    name       text not null,
    created_at text not null
  );
  create unique index if not exists uq_pinned_countries_name
    on pinned_countries (lower(name));
  create table if not exists api_keys (
    id            integer primary key autoincrement,
    name          text not null,
    key_hash      text not null unique,
    prefix        text not null,
    created_at    text not null,
    last_used_at  text,
    request_count integer not null default 0,
    revoked_at    text
  );
  create table if not exists sync_queue (
    id         integer primary key autoincrement,
    kind       text not null,
    payload    text not null,
    created_at text not null
  );
  create table if not exists local_meta (
    key   text primary key,
    value text not null
  );
`;

export class LocalStore {
  private db: SqliteDatabase;

  readonly path: string;

  constructor(db: SqliteDatabase, dbPath: string) {
    this.db = db;
    this.path = dbPath;
    db.exec("pragma journal_mode = WAL");
    db.exec("pragma synchronous = NORMAL");
    db.exec("pragma foreign_keys = ON");
    db.exec(DDL);
  }

  /**
   * Execute a translated (Postgres-dialect) statement. Reads and RETURNING
   * statements resolve rows; plain mutations resolve the affected-row count
   * (same convention as the Postgres helpers).
   */
  exec(sql: string, params: unknown[] = []): { rows: Record<string, unknown>[]; changes: number } {
    const { sql: sqliteSql, params: bindable } = translateToSqlite(sql, params);
    return this.raw(sqliteSql, bindable);
  }

  /**
   * Raw `?`-placeholder execution for the store's own statements — these must
   * NOT pass through the Postgres translator (it would find no `$n` and drop
   * every bound value).
   */
  private raw(sqliteSql: string, values: unknown[]): { rows: Record<string, unknown>[]; changes: number } {
    const stmt = this.db.prepare(sqliteSql);
    const bindable = values.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v));
    if (isReadStatement(sqliteSql) || hasReturningClause(sqliteSql)) {
      const rows = stmt.all(...bindable);
      return { rows, changes: rows.length };
    }
    const result = stmt.run(...bindable);
    return { rows: [], changes: Number(result.changes) };
  }

  /** Raw `?`-placeholder lookup for internal modules (outbox normalization). */
  select(sqliteSql: string, values: unknown[] = []): Record<string, unknown>[] {
    return this.raw(sqliteSql, values).rows;
  }

  // ── Outbox queue (statements waiting to replay to Postgres) ──────────────

  enqueue(kind: "sql" | "op", payload: unknown): void {
    this.db
      .prepare("insert into sync_queue (kind, payload, created_at) values (?, ?, ?)")
      .run(kind, JSON.stringify(payload), new Date().toISOString());
  }

  queueDepth(): number {
    const row = this.raw("select count(*) as n from sync_queue", []).rows[0];
    return Number(row?.n ?? 0);
  }

  readQueue(limit = 500): QueueEntry[] {
    return this.raw("select id, kind, payload from sync_queue order by id limit ?", [
      limit,
    ]).rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind === "op" ? "op" : "sql",
      payload: JSON.parse(String(r.payload)),
    }));
  }

  deleteQueued(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(", ");
    this.raw(`delete from sync_queue where id in (${placeholders})`, ids);
  }

  // ── Meta (hydration bookkeeping) ──────────────────────────────────────────

  getMeta(key: string): string | null {
    const row = this.raw("select value from local_meta where key = ?", [key]).rows[0];
    return row ? String(row.value) : null;
  }

  setMeta(key: string, value: string): void {
    this.raw(
      "insert into local_meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
      [key, value],
    );
  }

  // ── Snapshot ingestion (remote → local hydration) ─────────────────────────
  //
  // boards/listings are wiped and copied with their remote ids preserved, so
  // statements captured in the queue and ids already rendered in the UI stay
  // meaningful. User-owned tables merge by natural key (union), so rows added
  // locally during an outage survive.

  replaceFromSnapshot(snap: Snapshot): void {
    this.db.exec("begin");
    try {
      this.db.exec("delete from listings");
      this.db.exec("delete from boards");

      const insertBoard = this.db.prepare(
        `insert into boards (id, name, type, url, enabled, filter_keywords,
                             last_fetched_at, last_status, fetch_interval_hours)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const b of snap.boards) {
        insertBoard.run(
          b.id,
          b.name,
          b.type,
          b.url,
          b.enabled,
          b.filter_keywords,
          b.last_fetched_at ?? null,
          b.last_status ?? null,
          b.fetch_interval_hours,
        );
      }

      const insertListing = this.db.prepare(
        `insert into listings (id, board_id, external_id, title, company, location,
             is_remote, visa_sponsorship, remote_scope, tags, skills, url,
             posted_at, deadline, fetched_at, status, user_tags, search_text, description)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const l of snap.listings) {
        insertListing.run(
          l.id,
          l.board_id,
          l.external_id,
          l.title,
          l.company,
          l.location,
          l.is_remote,
          l.visa_sponsorship,
          l.remote_scope ?? null,
          l.tags,
          l.skills,
          l.url,
          l.posted_at ?? null,
          l.deadline ?? null,
          l.fetched_at,
          l.status,
          l.user_tags,
          l.search_text,
          l.description,
        );
      }

      for (const s of snap.appSettings) {
        this.setMetaGuardedSetting(s.key, s.value);
      }
      const insertFollowed = this.db.prepare(
        "insert into followed_companies (name, created_at) values (?, ?) on conflict do nothing",
      );
      for (const f of snap.followedCompanies) {
        insertFollowed.run(f.name, f.created_at);
      }
      const insertPinned = this.db.prepare(
        "insert into pinned_countries (name, created_at) values (?, ?) on conflict do nothing",
      );
      for (const c of snap.pinnedCountries) {
        insertPinned.run(c.name, c.created_at);
      }
      const upsertKey = this.db.prepare(
        `insert into api_keys (id, name, key_hash, prefix, created_at, last_used_at, request_count, revoked_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (key_hash) do update set
           last_used_at = excluded.last_used_at,
           request_count = excluded.request_count,
           revoked_at = excluded.revoked_at`,
      );
      for (const k of snap.apiKeys) {
        upsertKey.run(
          k.id,
          k.name,
          k.key_hash,
          k.prefix,
          k.created_at,
          k.last_used_at ?? null,
          k.request_count,
          k.revoked_at ?? null,
        );
      }

      this.setMeta("last_hydrated_at", new Date().toISOString());
      this.db.exec("commit");
    } catch (err) {
      this.db.exec("rollback");
      throw err;
    }
  }

  /** app_settings merge keeps a local-only key (written while offline). */
  private setMetaGuardedSetting(key: string, value: string): void {
    this.raw(
      "insert into app_settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
      [key, value],
    );
  }

  // ── Status ────────────────────────────────────────────────────────────────

  counts(): { boards: number; listings: number } {
    return {
      boards: Number(this.raw("select count(*) as n from boards", []).rows[0]?.n ?? 0),
      listings: Number(this.raw("select count(*) as n from listings", []).rows[0]?.n ?? 0),
    };
  }

  /** True when the mirror has never been filled (nothing cached to serve). */
  isEmpty(): boolean {
    return this.getMeta("last_hydrated_at") === null && this.counts().listings === 0;
  }

  /**
   * Seed the app's default boards into an empty mirror so a brand-new install
   * whose remote has never answered still has sources to refresh. Runs at most
   * once per store (flag-guarded); hydration later replaces these wholesale.
   */
  seedBoardsIfEmpty(): boolean {
    if (this.getMeta("seeded_defaults") !== null) return false;
    if (this.counts().boards > 0) {
      this.setMeta("seeded_defaults", new Date().toISOString());
      return false;
    }
    for (const b of SEED_BOARDS) {
      this.raw(
        "insert into boards (name, type, url, filter_keywords, enabled) values (?, ?, ?, ?, ?) on conflict (name) do nothing",
        [b.name, b.type, b.url, JSON.stringify(b.keywords), b.enabled === false ? 0 : 1],
      );
    }
    this.setMeta("seeded_defaults", new Date().toISOString());
    return true;
  }

  close(): void {
    this.db.close();
  }
}

// ── Process-wide singleton (HMR-safe), opened lazily ───────────────────────
//
// `node:sqlite` must be imported dynamically so runtimes without the module
// only lose the local cache, not the whole process. The global holds `null`
// after a failed open so later calls don't retry a hopeless environment.

declare const globalThis: { __jobradarLocalStore?: LocalStore | null };

/** Escape hatch: LOCAL_FIRST=0 restores plain remote-direct behavior. */
export function isLocalFirstEnabled(): boolean {
  return process.env.LOCAL_FIRST !== "0";
}

let opening: Promise<LocalStore | null> | null = null;

export async function getLocalStore(): Promise<LocalStore | null> {
  if (!isLocalFirstEnabled()) {
    globalThis.__jobradarLocalStore = null;
    return null;
  }
  if (globalThis.__jobradarLocalStore !== undefined) return globalThis.__jobradarLocalStore;
  opening ??= (async () => {
    try {
      const { DatabaseSync } = await import("node:sqlite");
      const dbPath = localDbPathFromEnv();
      const store = new LocalStore(new DatabaseSync(dbPath) as unknown as SqliteDatabase, dbPath);
      globalThis.__jobradarLocalStore = store;
      return store;
    } catch (err) {
      console.warn(
        "[jobradar] on-device store unavailable, falling back to remote-direct:",
        err instanceof Error ? err.message : err,
      );
      globalThis.__jobradarLocalStore = null;
      return null;
    } finally {
      opening = null;
    }
  })();
  return opening;
}

export function closeLocalStoreForTests(): void {
  globalThis.__jobradarLocalStore?.close();
  globalThis.__jobradarLocalStore = undefined;
}
