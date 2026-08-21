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
  // Older schemas had CHECK (type IN ('api','rss')) on boards.type — rebuild
  // the table without it so new board types (greenhouse) are accepted.
  const boardsSql = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'boards'").get() as
      | { sql: string }
      | undefined
  )?.sql;
  if (boardsSql && boardsSql.includes("CHECK")) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE"); // serialize against other processes/workers
    try {
      // re-check inside the write lock — another worker may have migrated already
      const sqlNow = (
        db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'boards'").get() as
          | { sql: string }
          | undefined
      )?.sql;
      if (sqlNow && sqlNow.includes("CHECK")) {
        db.exec("ALTER TABLE boards RENAME TO boards_old");
        db.exec(`CREATE TABLE boards (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          name                TEXT NOT NULL UNIQUE,
          type                TEXT NOT NULL,
          url                 TEXT NOT NULL,
          enabled             INTEGER NOT NULL DEFAULT 1,
          filter_keywords     TEXT NOT NULL DEFAULT '[]',
          last_fetched_at     TEXT,
          last_status         TEXT,
          fetch_interval_hours INTEGER NOT NULL DEFAULT 4
        )`);
        db.exec(
          "INSERT INTO boards (id, name, type, url, enabled, filter_keywords, last_fetched_at, last_status, fetch_interval_hours) " +
            "SELECT id, name, type, url, enabled, filter_keywords, last_fetched_at, last_status, fetch_interval_hours FROM boards_old",
        );
        db.exec("DROP TABLE boards_old");
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      name                TEXT NOT NULL UNIQUE,
      type                TEXT NOT NULL,
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

  // Repair databases broken by the interrupted boards rebuild: the listings
  // foreign key may still point at the dropped "boards_old" table, which
  // makes every INSERT fail with "no such table: main.boards_old".
  const listingsSql = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'listings'").get() as
      | { sql: string }
      | undefined
  )?.sql;
  if (listingsSql && listingsSql.includes("boards_old")) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      const nowSql = (
        db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'listings'").get() as
          | { sql: string }
          | undefined
      )?.sql;
      if (nowSql && nowSql.includes("boards_old")) {
        console.log("[jobradar:migrate] repairing listings foreign key (boards_old → boards)");
        db.exec(`CREATE TABLE listings_fixed (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          board_id         INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          external_id      TEXT NOT NULL,
          title            TEXT NOT NULL,
          company          TEXT NOT NULL DEFAULT '',
          location         TEXT NOT NULL DEFAULT '',
          is_remote        INTEGER NOT NULL DEFAULT 0,
          visa_sponsorship INTEGER NOT NULL DEFAULT 0,
          remote_scope     TEXT,
          tags             TEXT NOT NULL DEFAULT '[]',
          skills           TEXT NOT NULL DEFAULT '[]',
          url              TEXT NOT NULL DEFAULT '',
          posted_at        TEXT,
          fetched_at       TEXT NOT NULL,
          status           TEXT NOT NULL DEFAULT 'new'
                           CHECK (status IN ('new','favorite','applied','hidden')),
          user_tags        TEXT NOT NULL DEFAULT '[]',
          search_text      TEXT NOT NULL DEFAULT '',
          UNIQUE (board_id, external_id)
        )`);
        db.exec(`
          INSERT INTO listings_fixed (
            id, board_id, external_id, title, company, location,
            is_remote, visa_sponsorship, remote_scope, tags, skills, url,
            posted_at, fetched_at, status, user_tags, search_text
          )
          SELECT id, board_id, external_id, title, company, location,
                 is_remote, visa_sponsorship, remote_scope, tags, skills, url,
                 posted_at, fetched_at, status, user_tags, search_text
          FROM listings
        `);
        db.exec("DROP TABLE listings");
        db.exec("ALTER TABLE listings_fixed RENAME TO listings");
        db.exec("CREATE INDEX IF NOT EXISTS idx_listings_board ON listings(board_id)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status)");
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }

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
    name: "Remotive (Software Dev)",
    type: "api",
    url: "https://remotive.com/api/remote-jobs?category=software-dev&limit=100",
    keywords: [],
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
    name: "Working Nomads",
    type: "api",
    url: "https://www.workingnomads.com/api/exposed_jobs/",
    keywords: [],
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

  // ── Bangladesh sources (server-rendered HTML scrapers) ─────────────────
  {
    name: "Brain Station 23 (careers)",
    type: "scrape",
    url: "https://brainstation-23.easy.jobs/",
    keywords: [],
  },
  {
    name: "Nextjobz BD",
    type: "scrape",
    url: "https://nextjobz.com.bd/jobs",
    keywords: [],
  },

  // ── Company career pages (Greenhouse boards) ────────────────────────────
  // Remote-friendly companies with meaningful Java/Kotlin/Scala footprints.
  // filter_keywords pre-filter each company's full job board down to
  // backend-relevant roles before anything is stored.
  {
    name: "SumUp (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/sumup/jobs?content=true",
    keywords: ["java", "kotlin", "spring", "backend"],
  },
  {
    name: "HelloFresh (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/hellofresh/jobs?content=true",
    keywords: ["java", "kotlin", "spring", "backend"],
  },
  {
    name: "Coinbase (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/coinbase/jobs?content=true",
    keywords: ["java", "kotlin", "backend"],
  },
  {
    name: "Neo4j (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/neo4j/jobs?content=true",
    keywords: ["java", "kotlin", "backend"],
  },
  {
    name: "Wise (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/wise/jobs?content=true",
    keywords: ["java", "kotlin", "spring", "backend"],
  },
  {
    name: "Databricks (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/databricks/jobs?content=true",
    keywords: ["java", "scala", "backend"],
  },
  {
    name: "Okta (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/okta/jobs?content=true",
    keywords: ["java", "spring", "backend"],
  },
  {
    name: "Twilio (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/twilio/jobs?content=true",
    keywords: ["java", "backend"],
  },
  {
    name: "N26 (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/n26/jobs?content=true",
    keywords: ["java", "kotlin", "spring", "backend"],
  },
  {
    name: "GetYourGuide (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/getyourguide/jobs?content=true",
    keywords: ["kotlin", "java", "backend"],
  },
  {
    name: "Celonis (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/celonis/jobs?content=true",
    keywords: ["java", "backend"],
  },
];

function seed(db: DatabaseSync) {
  // Idempotent: insert any seed boards missing from this database,
  // leaving user-added/edited boards untouched.
  const ins = db.prepare(
    "INSERT OR IGNORE INTO boards (name, type, url, filter_keywords, enabled) VALUES (?, ?, ?, ?, ?)",
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
