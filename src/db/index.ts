import type { Board, BoardType, Listing, ListingStatus } from "@/lib/types";
import {
  remoteQuery,
  remoteRun,
  remoteRunReturning,
  setRemoteHarness,
  type RemoteHarness,
} from "@/db/remote";

// Every read/write in the app funnels through q/qOne/run, which are thin
// wrappers over the Neon (postgres.js) helpers in remote.ts. Failures throw;
// callers classify them with classifyRemoteError (db/errors.ts).

export { getDb } from "@/db/remote";

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

/** True for SELECT / WITH statements; everything else is a write. */
function isReadStatement(query: string): boolean {
  return /^\s*(select|with)\b/i.test(query);
}

/** Run a query and return all rows. */
export async function q<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (isReadStatement(query)) return remoteQuery<T>(query, params);
  if (/\breturning\b/i.test(query)) return remoteRunReturning<T>(query, params);
  await remoteRun(query, params);
  return [];
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
  return remoteRun(query, params);
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
