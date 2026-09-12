import postgres from "postgres";
import type { Board, BoardType, Listing, ListingStatus } from "@/lib/types";

// ── Postgres connection (Neon; singleton survives HMR via globalThis) ──

declare const globalThis: {
  __jobradarSql?: postgres.Sql;
  __jobradarSchemaReady?: Promise<void>;
};

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
 * Schema + seed, applied once per process before the first query. The DDL is
 * idempotent, so concurrent instances racing on a fresh database converge.
 */
function ensureSchema(): Promise<void> {
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

// ── Query helpers (all funnel through ensureSchema) ────────────────────────

/** Run a query and return all rows. */
export async function q<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ensureSchema();
  return (await getDb().unsafe(query, params as never[])) as T[];
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
  await ensureSchema();
  const result = await getDb().unsafe(query, params as never[]);
  return result.count;
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
  const CHUNK = 20;
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

  // ── International sources ─────────────────────────────────────────────────
  // Broad tech ingestion by design: each board carries its source's tech/dev
  // category (no java-only narrowing at fetch time — Java filtering happens in
  // the UI via global keywords and skill facets). Descriptions come from the
  // feed directly (Jobicy) or via bounded detail enrichment (Arc, Relocate.me,
  // Reed) so skills extraction has material at upsert time.
  {
    // v2 API, industry=engineering = Jobicy's "Software Engineering" category
    // (replaces the old "Jobicy (Java tag)" RSS seed that 403'd)
    name: "Jobicy",
    type: "api",
    url: "https://jobicy.com/api/v2/remote-jobs?count=50&industry=engineering",
    keywords: [],
  },
  {
    // __NEXT_DATA__ listing; detail enrichment adds description + visa flag +
    // company (vetted jobs). requiredCountries=[] maps to "Anywhere".
    name: "Arc.dev",
    type: "scrape",
    url: "https://arc.dev/remote-jobs",
    keywords: [],
  },
  {
    // relocation-native EU/UK board; SSR cards + JSON-LD detail enrichment
    name: "Relocate.me",
    type: "scrape",
    url: "https://relocate.me/international-jobs",
    keywords: [],
  },
  {
    // UK board with a free jobseeker API — needs REED_API_KEY (Basic auth),
    // so seeded disabled; enable once the key is configured
    name: "Reed (UK)",
    type: "api",
    url: "https://www.reed.co.uk/api/1.0/search?keywords=developer&resultsToTake=100",
    keywords: [],
    enabled: false,
  },

  // ── Japan sources ───────────────────────────────────────────────────────
  // JapanDev: public web API (list has no description — adapter enriches
  // from detail endpoints). TokyoDev: SSR listing page, plain HTML scrape;
  // descriptions filled via headless-browser detail enrichment.
  {
    name: "JapanDev",
    type: "api",
    url: "https://api.japan-dev.com/api/v1/jobs?page=1",
    keywords: [],
  },
  {
    name: "TokyoDev",
    type: "scrape",
    url: "https://www.tokyodev.com/jobs",
    keywords: [],
  },

  {
    name: "BDJobs IT",
    type: "api",
    url: "https://api.bdjobs.com/Jobs/api/JobSearch/GetJobSearch?category=8",
    keywords: [],
  },
  {
    name: "Cefalo (careers)",
    type: "scrape",
    url: "https://career.cefalo.com/",
    keywords: [],
  },
  {
    name: "Tekarsh (careers)",
    type: "api",
    url: "https://tekarsh.com/api/admin/jobs?limit=1000",
    keywords: [],
  },
  {
    name: "Craftsmen (careers)",
    type: "api",
    url: "https://api.smartrecruiters.com/v1/companies/CraftsmenLtd/postings",
    keywords: [],
  },

  // ── Bangladesh sources (server-rendered HTML scrapers) ─────────────────
  {
    name: "Brain Station 23 (careers)",
    type: "scrape",
    url: "https://brainstation-23.easy.jobs/",
    keywords: [],
  },
  // easy.jobs tenants — BD tech companies on the country's dominant hiring
  // platform. Tenants with zero current openings render an explicit empty
  // state (fetched as "ok · 0"), and pick up jobs automatically when posted.
  {
    name: "Vivasoft (careers)",
    type: "scrape",
    url: "https://vivasoft.easy.jobs/",
    keywords: [],
  },
  {
    name: "Chaldal (careers)",
    type: "scrape",
    url: "https://chaldal.easy.jobs/",
    keywords: [],
  },
  {
    name: "Sheba Platform (careers)",
    type: "scrape",
    url: "https://sheba.easy.jobs/",
    keywords: [],
  },
  {
    name: "Datasoft Systems (careers)",
    type: "scrape",
    url: "https://datasoft.easy.jobs/",
    keywords: [],
  },
  {
    name: "KONA Software Lab (careers)",
    type: "scrape",
    url: "https://konasl.easy.jobs/",
    keywords: [],
  },
  {
    name: "Pathao (careers)",
    type: "scrape",
    url: "https://pathao.easy.jobs/",
    keywords: [],
  },
  {
    name: "LEADS Corporation (careers)",
    type: "scrape",
    url: "https://leads.easy.jobs/",
    keywords: [],
  },
  {
    name: "Dream 71 (careers)",
    type: "scrape",
    url: "https://dream71.easy.jobs/",
    keywords: [],
  },
  {
    name: "Shohoz (careers)",
    type: "scrape",
    url: "https://shohoz.easy.jobs/",
    keywords: [],
  },
  // single-company career feeds (company name filled from the board name)
  {
    name: "Enosis Solutions (careers)",
    type: "rss",
    url: "https://careers.enosisbd.com/jobs.rss",
    keywords: [],
  },
  {
    name: "Southtech Group (careers)",
    type: "rss",
    url: "https://career.southtechgroup.com/feed/",
    keywords: [],
  },
  {
    name: "Riseup Labs (careers)",
    type: "scrape",
    url: "https://riseuplabs.com/jobs/",
    keywords: [],
  },
  // IoT/telecom tech company hiring via SmartRecruiters (host dispatch above)
  {
    name: "Bondstein Technologies (careers)",
    type: "api",
    url: "https://api.smartrecruiters.com/v1/companies/BondsteinTechnologiesLtd/postings",
    keywords: [],
  },
  {
    name: "Daraz (careers)",
    type: "scrape",
    url: "https://daraz.easy.jobs/",
    keywords: [],
  },
  // general BD portal — newest ~25 jobs per fetch, filtered to tech titles;
  // each job names its real hiring company, covering many employers at once
  {
    name: "Skill.jobs (tech)",
    type: "scrape",
    url: "https://skill.jobs/browse-jobs",
    keywords: [],
  },
  {
    name: "Nextjobz BD",
    type: "scrape",
    url: "https://nextjobz.com.bd/it-jobs",
    keywords: [],
  },
  {
    name: "Airwork BD",
    type: "scrape",
    url: "https://ignition.airwork.ai/api/v2/public/jobs",
    keywords: [],
  },
  {
    name: "Talvette",
    type: "scrape",
    url: "https://api.sheety.co/d6464fb14c638c8070881d5e8789c1fc/talvetteLiveJoblist/liveJobs",
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
