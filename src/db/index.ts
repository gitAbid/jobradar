import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Board, BoardType, Listing, ListingStatus } from "@/lib/types";

// ── Singleton DB (survives HMR via globalThis) ─────────────────────────────

declare const globalThis: { __jobradarDb?: DatabaseSync };

function createDb(): DatabaseSync {
  const dir = path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "jobs.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  seed(db);
  return db;
}

export function getDb(): DatabaseSync {
  if (!globalThis.__jobradarDb) globalThis.__jobradarDb = createDb();
  return globalThis.__jobradarDb;
}

// ── Schema ──────────────────────────────────────────────────────────────────

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      name                TEXT NOT NULL UNIQUE,
      type                TEXT NOT NULL CHECK (type IN ('api','rss')),
      url                 TEXT NOT NULL,
      enabled             INTEGER NOT NULL DEFAULT 1,
      filter_keywords     TEXT NOT NULL DEFAULT '[]',
      last_fetched_at     TEXT,
      last_status         TEXT,
      fetch_interval_hours INTEGER NOT NULL DEFAULT 4
    );

    CREATE TABLE IF NOT EXISTS listings (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id         INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      external_id      TEXT NOT NULL,
      title            TEXT NOT NULL,
      company          TEXT NOT NULL DEFAULT '',
      location         TEXT NOT NULL DEFAULT '',
      is_remote        INTEGER NOT NULL DEFAULT 0,
      visa_sponsorship INTEGER NOT NULL DEFAULT 0,
      tags             TEXT NOT NULL DEFAULT '[]',
      url              TEXT NOT NULL DEFAULT '',
      posted_at        TEXT,
      fetched_at       TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','favorite','applied','hidden')),
      user_tags        TEXT NOT NULL DEFAULT '[]',
      search_text      TEXT NOT NULL DEFAULT '',
      UNIQUE (board_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_listings_board ON listings(board_id);
    CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // lightweight column migrations for pre-existing databases
  const listingCols = (
    db.prepare("PRAGMA table_info(listings)").all() as Array<{ name: string }>
  ).map((c) => c.name);
  if (!listingCols.includes("skills")) {
    db.exec("ALTER TABLE listings ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'");
  }
  if (!listingCols.includes("remote_scope")) {
    db.exec("ALTER TABLE listings ADD COLUMN remote_scope TEXT");
  }
}

// ── Seed boards on first run ───────────────────────────────────────────────

const SEED_BOARDS: Array<{
  name: string;
  type: BoardType;
  url: string;
  keywords: string[];
  enabled?: boolean;
}> = [
  {
    name: "RemoteOK",
    type: "api",
    url: "https://remoteok.com/api",
    keywords: ["java"],
  },
  {
    name: "Remotive",
    type: "api",
    url: "https://remotive.com/api/remote-jobs?search=java",
    keywords: ["java", "spring"],
  },
  {
    name: "Arbeitnow",
    type: "api",
    url: "https://www.arbeitnow.com/api/job-board-api",
    keywords: ["java", "spring"],
  },
  {
    name: "HimalayasApp",
    type: "api",
    url: "https://himalayas.app/jobs/api",
    keywords: ["java", "spring boot"],
  },
  {
    name: "WeWorkRemotely (Backend)",
    type: "rss",
    url: "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
    keywords: ["java", "spring"],
  },
  {
    name: "Jobicy (Java tag)",
    type: "rss",
    url: "https://jobicy.com/feed/job-tag/java",
    keywords: [],
    enabled: false, // currently returns 403 to server-side fetchers; enable to retry
  },
];

function seed(db: DatabaseSync) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM boards").get() as {
    c: number;
  };
  if (count.c > 0) return;
  const ins = db.prepare(
    "INSERT INTO boards (name, type, url, filter_keywords, enabled) VALUES (?, ?, ?, ?, ?)",
  );
  for (const b of SEED_BOARDS) {
    ins.run(b.name, b.type, b.url, JSON.stringify(b.keywords), b.enabled === false ? 0 : 1);
  }
}

// ── Row mappers ─────────────────────────────────────────────────────────────

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
    id: r.id,
    name: r.name,
    type: r.type as BoardType,
    url: r.url,
    enabled: r.enabled === 1,
    filterKeywords: safeParse(r.filter_keywords),
    lastFetchedAt: r.last_fetched_at,
    lastStatus: r.last_status,
    fetchIntervalHours: r.fetch_interval_hours,
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
  tags: string;
  skills?: string;
  remote_scope?: string | null;
  url: string;
  posted_at: string | null;
  fetched_at: string;
  status: string;
  user_tags: string;
  search_text?: string;
  board_filter_keywords?: string;
}

export function rowToListing(r: ListingRow): Listing & {
  boardName: string;
  boardFilterKeywords: string[];
  searchText: string;
} {
  return {
    id: r.id,
    boardId: r.board_id,
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
    fetchedAt: r.fetched_at,
    status: r.status as ListingStatus,
    userTags: safeParse(r.user_tags),
    boardFilterKeywords: safeParse(r.board_filter_keywords ?? "[]"),
    searchText: r.search_text ?? "",
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
