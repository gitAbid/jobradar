import type { Board, BoardType, Listing, ListingStatus } from "@/lib/types";
import {
  classifyRemoteError,
  isReadStatement,
  translateToSqlite,
} from "@/db/translate";
import {
  isRemoteConfigured,
  remoteQuery,
  remoteRun,
  remoteRunReturning,
  setRemoteHarness,
  type RemoteHarness,
} from "@/db/remote";
import { getBreaker } from "@/db/remote-health";
import { getLocalStore, type LocalStore } from "@/db/local-store";
import { drainOutbox, ensureFreshLocal, persistBreakerState } from "@/db/sync";
import {
  bufferBlobOps,
  drainBlobOps,
  ensureFallbackStore,
  isBlobServeMode,
} from "@/lib/blob-sync";
import type { OutboxOp } from "@/db/outbox";

// ── Local-first query router ───────────────────────────────────────────────
//
// Every read/write in the app funnels through q/qOne/run. The routing policy:
//
//   reads    → memory cache → on-device SQLite (primary) → remote, with the
//              mirror refreshed from Neon lazily (initial + 2min catch-up)
//   writes   → on-device SQLite immediately (authority), then write-through
//              to Neon; if Neon is unreachable or over limits the statement
//              is queued in the local outbox and replayed FIFO on recovery
//
// A circuit breaker (remote-health.ts) trips on connection/limit failures and
// re-probes after a backoff window, so a dead or quota-capped database never
// takes the app down.

export { getDb } from "@/db/remote";
export { dbStatus, initBackgroundSync } from "@/db/sync";
export type { DbStatus } from "@/db/sync";

const MEMORY_TTL_MS = 10_000;
const MEMORY_MAX_ENTRIES = 300;

interface CacheEntry {
  at: number;
  gen: number;
  rows: Record<string, unknown>[];
}

declare const globalThis: {
  __jobradarCache?: Map<string, CacheEntry>;
  __jobradarCacheGen?: number;
};

function cache(): Map<string, CacheEntry> {
  globalThis.__jobradarCache ??= new Map();
  return globalThis.__jobradarCache;
}

function cacheGen(): number {
  globalThis.__jobradarCacheGen ??= 0;
  return globalThis.__jobradarCacheGen;
}

function invalidateCache(): void {
  globalThis.__jobradarCacheGen = cacheGen() + 1;
  globalThis.__jobradarCache?.clear();
}

/** Escape hatch: LOCAL_FIRST=0 restores plain remote-direct behavior. */
export { isLocalFirstEnabled } from "@/db/local-store";

async function localStore(): Promise<LocalStore | null> {
  return getLocalStore();
}

// ── Read path ──────────────────────────────────────────────────────────────

async function readRows<T>(
  query: string,
  params: unknown[],
  key: string,
): Promise<T[]> {
  const entry = cache().get(key);
  if (entry && entry.gen === cacheGen() && Date.now() - entry.at < MEMORY_TTL_MS) {
    return entry.rows as T[];
  }
  const remember = (rows: Record<string, unknown>[]): T[] => {
    cache().set(key, { at: Date.now(), gen: cacheGen(), rows });
    if (cache().size > MEMORY_MAX_ENTRIES) cache().clear();
    return rows as T[];
  };

  const store = await localStore();
  if (store && !isBlobServeMode()) {
    // local-first read path (long-lived hosts): mirror → remote hydration
    await ensureFreshLocal().catch(() => {});
    try {
      return remember(store.exec(query, params).rows);
    } catch (err) {
      console.error("[jobradar] local read failed, trying remote:", err);
    }
  }

  // Remote-first (serverless remote-direct, or Blob serve mode): the remote
  // is the authority. While the breaker is open we skip the 6 s timeout and
  // serve from the Blob-seeded fallback straight away.
  const breaker = getBreaker();
  if (isBlobServeMode() && !breaker.canAttempt()) {
    const fallback = await ensureFallbackStore().catch(() => null);
    if (fallback) {
      try {
        return remember(fallback.exec(query, params).rows);
      } catch (err) {
        console.error("[jobradar] fallback read failed:", err);
      }
    }
    throw new Error("Database unreachable and no local backup is available");
  }

  // remote-direct mode (no on-device store) or local read failure
  try {
    const rows = await remoteQuery<T>(query, params);
    getBreaker().recordSuccess();
    return remember(rows as Record<string, unknown>[]);
  } catch (err) {
    const cls = classifyRemoteError(err);
    if (cls === "query") throw err;
    getBreaker().recordFailure(err, cls);
    if (isBlobServeMode()) {
      const fallback = await ensureFallbackStore().catch(() => null);
      if (fallback) {
        try {
          console.warn("[jobradar] serving read from Blob-backed fallback");
          return remember(fallback.exec(query, params).rows);
        } catch (fbErr) {
          console.error("[jobradar] fallback read failed:", fbErr);
        }
      }
    }
    throw err;
  }
}

// ── Write path ─────────────────────────────────────────────────────────────

/**
 * Statements captured while the remote is down are normalized into
 * replay-safe ops (natural keys instead of local row ids) — see outbox.ts.
 * DDL and the unnest-based seed are remote-internal and never queued.
 */
async function enqueueForSync(
  store: LocalStore,
  query: string,
  params: unknown[],
): Promise<OutboxOp | null> {
  if (/\bunnest\s*\(/i.test(query)) return null;
  const { toOutboxOp } = await import("@/db/outbox");
  const op = toOutboxOp(query, params, store);
  store.enqueue(op.kind === "sql" ? "sql" : "op", op);
  return op;
}

async function writeRows(
  query: string,
  params: unknown[],
  wantRows: boolean,
): Promise<{ rows: Record<string, unknown>[]; count: number }> {
  const store = await localStore();
  const translated = translateToSqlite(query, params);
  let localCount: number | undefined;
  let localRows: Record<string, unknown>[] | undefined;

  const doLocalWrite = (s: LocalStore): void => {
    try {
      const res = s.exec(query, params);
      localCount = res.changes;
      localRows = res.rows;
    } catch (err) {
      console.error("[jobradar] local write failed:", err);
    }
  };

  if (store && !translated.skipLocal && !isBlobServeMode()) {
    doLocalWrite(store);
  }

  const settleLocal = (): { rows: Record<string, unknown>[]; count: number } => {
    invalidateCache();
    return { rows: localRows ?? [], count: localCount ?? 0 };
  };

  /**
   * Blob offline write (serverless only): open the snapshot-seeded fallback,
   * apply the write, queue it locally and buffer the op for Blob upload so
   * the mutation survives the instance.
   */
  const writeOffline = async (): Promise<{ rows: Record<string, unknown>[]; count: number } | null> => {
    if (!isBlobServeMode()) return null;
    const fallback = await ensureFallbackStore().catch(() => null);
    if (!fallback) return null;
    if (!translated.skipLocal) doLocalWrite(fallback);
    const op = await enqueueForSync(fallback, query, params).catch(() => null);
    if (op) bufferBlobOps(op);
    return settleLocal();
  };

  const queueOrBuffer = async (s: LocalStore | null): Promise<void> => {
    if (s) {
      const op = await enqueueForSync(s, query, params).catch(() => null);
      if (op) bufferBlobOps(op);
    } else {
      await writeOffline();
    }
  };

  if (!isRemoteConfigured()) {
    if (!store) await writeOffline();
    return settleLocal();
  }

  const breaker = getBreaker();
  if (!breaker.canAttempt()) {
    if (store) {
      const op = await enqueueForSync(store, query, params).catch(() => null);
      if (op) bufferBlobOps(op);
    } else {
      await writeOffline();
    }
    return settleLocal();
  }

  try {
    if (wantRows) {
      const rows = await remoteRunReturning(query, params);
      breaker.recordSuccess();
      invalidateCache();
      void kickDrain();
      return { rows, count: rows.length };
    }
    const count = await remoteRun(query, params);
    breaker.recordSuccess();
    invalidateCache();
    void kickDrain();
    return { rows: localRows ?? [], count };
  } catch (err) {
    const cls = classifyRemoteError(err);
    if (cls === "query") {
      // real SQL/constraint bug — surface it exactly like the direct driver
      throw err;
    }
    breaker.recordFailure(err, cls);
    console.warn(
      `[jobradar] remote write failed (${cls}) — queued locally:`,
      err instanceof Error ? err.message : err,
    );
    if (store) {
      persistBreakerState(store);
      await queueOrBuffer(store);
    } else {
      await writeOffline();
    }
    return settleLocal();
  }
}

/** After a successful write, opportunistically flush anything still queued. */
async function kickDrain(): Promise<void> {
  const store = await localStore();
  if (store && store.queueDepth() > 0 && getBreaker().status().state === "up") {
    await drainOutbox(store).catch(() => {});
  }
  // Blob backlog rides along (throttled + breaker-gated inside, no-op
  // without a connected store) — this is the line that fires on serverless,
  // where there is no local store to gate on.
  await drainBlobOps().catch(() => {});
}

// ── Query helpers (the app's entire data surface) ──────────────────────────

/**
 * Pool-pruned listing columns for list views and the public API.
 *
 * `description` (~9 MB across the table) and `search_text` (~3 MB) dominate
 * row bytes but are never used by filtering, facets, search or cards — only
 * the expandable details of the ~20 visible rows need `description`
 * (fetched second via `qDescriptionsByIds`). Every dashboard page and API
 * hit used to pull the full table (~12 MB from Neon); the pruned pool is
 * ~0.5 MB. `rowToListing` tolerates the missing keys (defaults "").
 */
export const LISTING_POOL_SELECT = [
  "l.id",
  "l.board_id",
  "l.external_id",
  "l.title",
  "l.company",
  "l.location",
  "l.is_remote",
  "l.visa_sponsorship",
  "l.remote_scope",
  "l.tags",
  "l.skills",
  "l.url",
  "l.posted_at",
  "l.deadline",
  "l.fetched_at",
  "l.status",
  "l.user_tags",
].join(", ");

/** Descriptions for one page of visible rows — small and bounded. */
export async function qDescriptionsByIds(ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((n) => Number.isInteger(n)))];
  if (unique.length === 0) return new Map();
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await q<{ id: number; description: string }>(
    `select id, description from listings where id in (${placeholders})`,
    unique,
  );
  return new Map(
    rows.map((r) => [Number(r.id), typeof r.description === "string" ? r.description : ""]),
  );
}

/** Patch descriptions onto already-paginated view entries (mutates in place). */
export async function attachDescriptions<
  T extends { listing: { id: number; description: string } },
>(entries: T[]): Promise<T[]> {
  if (entries.length === 0) return entries;
  const byId = await qDescriptionsByIds(entries.map((e) => e.listing.id));
  for (const e of entries) e.listing.description = byId.get(e.listing.id) ?? "";
  return entries;
}

/** Run a query and return all rows. */
export async function q<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (isReadStatement(query)) {
    return readRows<T>(query, params, `${query}\u0000${JSON.stringify(params)}`);
  }
  const { rows } = await writeRows(query, params, /\breturning\b/i.test(query));
  return rows as T[];
}

/** Run a query and return the first row, if any. */
export async function qOne<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await q<T>(query, params);
  return rows[0];
}

/** Run a mutating query; returns the number of affected rows. */
export async function run(query: string, params: unknown[] = []): Promise<number> {
  if (isReadStatement(query)) return (await q(query, params)).length;
  const { count } = await writeRows(query, params, false);
  return count;
}

// ── Cross-cutting helpers ──────────────────────────────────────────────────

export interface NewListingRow {
  externalId: string;
  title: string;
  company: string;
  location: string;
  isRemote: boolean;
  visaSponsorship: boolean;
  remoteScope: string | null;
  tags: string;
  skills: string;
  url: string;
  postedAt: string | null;
  deadline: string | null;
  fetchedAt: string;
  searchText: string;
  description: string;
}

const INSERT_COLUMNS = [
  "board_id",
  "external_id",
  "title",
  "company",
  "location",
  "is_remote",
  "visa_sponsorship",
  "remote_scope",
  "tags",
  "skills",
  "url",
  "posted_at",
  "deadline",
  "fetched_at",
  "search_text",
  "description",
] as const;

/**
 * Bulk-insert new listings, skipping rows that already exist for the board.
 * Multi-row chunks keep the round-trip count sane over the network.
 */
export async function insertListings(boardId: number, rows: NewListingRow[]): Promise<number> {
  const valid = rows.filter((r) => r.title && r.url); // skip malformed entries
  let inserted = 0;
  const CHUNK = 50;
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const tuples = chunk.map((r) => {
      const base = params.length;
      params.push(
        boardId,
        r.externalId,
        r.title,
        r.company,
        r.location,
        r.isRemote ? 1 : 0,
        r.visaSponsorship ? 1 : 0,
        r.remoteScope,
        r.tags,
        r.skills,
        r.url,
        r.postedAt,
        r.deadline,
        r.fetchedAt,
        r.searchText,
        r.description,
      );
      return `(${INSERT_COLUMNS.map((_, n) => `$${base + n + 1}`).join(", ")})`;
    });
    inserted += await run(
      `insert into listings (${INSERT_COLUMNS.join(", ")}) values ${tuples.join(", ")}
       on conflict (board_id, external_id) do nothing`,
      params,
    );
  }
  return inserted;
}

/** External ids of a board's rows that already carry an enriched field. */
export async function knownEnrichedExternalIds(
  boardId: number,
  by: "description" | "skills",
): Promise<Set<string>> {
  const filter = by === "description" ? "description <> ''" : "skills <> '[]'";
  const rows = await q<{ external_id: string }>(
    `select external_id from listings where board_id = $1 and ${filter}`,
    [boardId],
  );
  return new Set(rows.map((r) => r.external_id));
}

export interface EnrichPatch {
  externalId: string;
  searchText: string;
  skills: string;
  description: string;
  visaSponsorship?: number;
  company?: string;
  postedAt?: string | null;
  deadline?: string | null;
  location?: string;
  tags?: string;
}

// column → value extractor; a column is written when any patch defines it
const ENRICH_COLUMNS: Array<[string, (p: EnrichPatch) => unknown]> = [
  ["search_text", (p) => p.searchText],
  ["skills", (p) => p.skills],
  ["visa_sponsorship", (p) => p.visaSponsorship],
  ["company", (p) => p.company],
  ["posted_at", (p) => p.postedAt],
  ["deadline", (p) => p.deadline],
  ["location", (p) => p.location],
  ["tags", (p) => p.tags],
  ["description", (p) => p.description],
];

/**
 * Persist enrichment results onto already-stored rows (the upsert in
 * insertListings never overwrites existing rows, so adapters write
 * descriptions/skills/flags back explicitly). Column names come from the
 * fixed allowlist above — never from user input.
 */
export async function persistEnrichment(
  boardId: number,
  patches: EnrichPatch[],
  opts: { onlyWhenUnenriched?: boolean } = {},
): Promise<void> {
  if (patches.length === 0) return;
  const columns = ENRICH_COLUMNS.filter(([, get]) =>
    patches.some((p) => get(p) !== undefined),
  );
  const setClause = columns.map(([col], n) => `${col} = $${n + 1}`).join(", ");
  const extraWhere = opts.onlyWhenUnenriched ? " and skills = '[]'" : "";
  for (const p of patches) {
    const values = columns.map(([, get]) => get(p));
    await run(
      `update listings set ${setClause} where board_id = $${columns.length + 1} and external_id = $${columns.length + 2}${extraWhere}`,
      [...values, boardId, p.externalId],
    );
  }
}

// ── Followed companies ─────────────────────────────────────────────────────

/** All followed company names, alphabetical (case-insensitive). */
export async function listFollowedCompanies(): Promise<string[]> {
  const rows = await q<{ name: string }>(
    "select name from followed_companies order by lower(name)",
  );
  return rows.map((r) => r.name);
}

// ── Pinned countries ───────────────────────────────────────────────────────

/** All pinned country names, alphabetical (case-insensitive). */
export async function listPinnedCountries(): Promise<string[]> {
  const rows = await q<{ name: string }>(
    "select name from pinned_countries order by lower(name)",
  );
  return rows.map((r) => r.name);
}

// ── Row mappers ────────────────────────────────────────────────────────────

interface BoardRow {
  id: number;
  name: string;
  type: string;
  url: string;
  enabled: number;
  filter_keywords: string;
  last_fetched_at: string | null;
  last_status: string | null;
  fetch_interval_hours: number;
}

export function rowToBoard(r: BoardRow): Board {
  return {
    id: Number(r.id),
    name: r.name,
    type: r.type as BoardType,
    url: r.url,
    enabled: r.enabled === 1,
    filterKeywords: safeParse(r.filter_keywords),
    lastFetchedAt: r.last_fetched_at,
    lastStatus: r.last_status,
    fetchIntervalHours: Number(r.fetch_interval_hours),
  };
}

interface ListingRow {
  id: number;
  board_id: number;
  board_name?: string;
  external_id: string;
  title: string;
  company: string;
  location: string;
  is_remote: number;
  visa_sponsorship: number;
  remote_scope?: string | null;
  tags: string;
  skills?: string;
  url: string;
  posted_at: string | null;
  deadline?: string | null;
  fetched_at: string;
  status: string;
  user_tags: string;
  search_text?: string;
  description?: string;
  board_filter_keywords?: string;
}

export function rowToListing(r: ListingRow): Listing & {
  boardName: string;
  boardFilterKeywords: string[];
  searchText: string;
  description: string;
} {
  return {
    id: Number(r.id),
    boardId: Number(r.board_id),
    boardName: r.board_name ?? "",
    externalId: r.external_id,
    title: r.title,
    company: r.company,
    location: r.location,
    isRemote: r.is_remote === 1,
    visaSponsorship: r.visa_sponsorship === 1,
    remoteScope: (r.remote_scope as "anywhere" | "restricted" | null) ?? null,
    tags: safeParse(r.tags),
    skills: safeParse(r.skills ?? "[]"),
    url: r.url,
    postedAt: r.posted_at,
    deadline: r.deadline ?? null,
    fetchedAt: r.fetched_at,
    status: r.status as ListingStatus,
    userTags: safeParse(r.user_tags),
    boardFilterKeywords: safeParse(r.board_filter_keywords ?? "[]"),
    searchText: r.search_text ?? "",
    description: r.description ?? "",
  };
}

function safeParse(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// ── Test hooks ─────────────────────────────────────────────────────────────

export { setRemoteHarness };
export type { RemoteHarness };

/** Wipe all local-first state (store, breaker, cache) between tests. */
export async function resetLocalFirstForTests(): Promise<void> {
  const { closeLocalStoreForTests } = await import("@/db/local-store");
  const { resetBreakerForTests } = await import("@/db/remote-health");
  const { resetSyncStateForTests } = await import("@/db/sync");
  closeLocalStoreForTests();
  resetBreakerForTests();
  resetSyncStateForTests();
  globalThis.__jobradarCache = undefined;
  globalThis.__jobradarCacheGen = undefined;
}
