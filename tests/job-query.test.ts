import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { COUNTRY_FACETS, countryFacetValue } from "@/lib/facets";
import { BD_LOCATION_RE, isBangladeshRelevant } from "@/lib/bd";
import { buildJobView, type RawParams } from "@/lib/job-view";
import {
  buildFacetQuery,
  buildPageQuery,
  escapeLike,
  jsRegexToPg,
  keywordRegexSource,
  runJobQuery,
  type SqlExec,
} from "@/lib/job-query";
import type { FilterableListing } from "@/lib/types";

let db: PGlite;
let exec: SqlExec;
let pool: FilterableListing[]; // oracle input, in feed order

const BOARDS = [
  { id: 1, name: "RemoteOK", keywords: [] as string[] },
  { id: 2, name: "Remotive", keywords: ["visa sponsorship"] },
  { id: 3, name: "BDJobs", keywords: ["c++"] },
];

interface Fx {
  id: number;
  board: number;
  title: string;
  company?: string;
  location?: string;
  remote?: boolean;
  scope?: "anywhere" | "restricted" | null;
  visa?: boolean;
  tags?: string[];
  skills?: string[];
  posted?: string | null;
  fetched?: string;
  status?: "new" | "favorite" | "applied" | "hidden";
}

const FIXTURES: Fx[] = [
  { id: 1, board: 1, title: "Java Engineer", company: "Acme", location: "Remote", remote: true, scope: "anywhere", tags: ["java"], skills: ["Java"], posted: "2026-09-10T00:00:00Z" },
  { id: 2, board: 1, title: "JavaScript Developer", company: "Acme", location: "Berlin, Germany", tags: ["javascript"], skills: ["JavaScript"], posted: "2026-09-10T00:00:00Z" }, // same sort key as id 1
  { id: 3, board: 1, title: "Java Engineer", company: "ACME", location: "Munich", remote: true, scope: "restricted", tags: ["Java"], skills: ["Java", "Spring"], posted: "2026-09-09T00:00:00Z" }, // dupe of 1 (case)
  { id: 4, board: 2, title: "Senior Backend Lead", company: "Beta", location: "Remote - USA only", remote: true, scope: "restricted", visa: true, tags: [], skills: ["Python"], posted: null, fetched: "2026-09-08T00:00:00Z" },
  { id: 5, board: 2, title: "Hidden Java Role", company: "Beta", location: "Remote", remote: true, scope: "anywhere", tags: ["java"], skills: ["Java"], posted: "2026-09-12T00:00:00Z", status: "hidden" },
  { id: 6, board: 3, title: "C++ Developer", company: "Gamma", location: "Dhaka (DOHS Mirpur)", tags: ["c++"], skills: ["C++"], posted: "2026-09-07T00:00:00Z", status: "favorite" },
  { id: 7, board: 3, title: "100% Match_Case Dev", company: "Delta", location: "Paris", tags: ["50% off"], skills: [], posted: "2026-09-06T00:00:00Z", status: "applied" },
  { id: 8, board: 3, title: "Plain Developer", company: "Delta", location: "Somewhere", tags: ["x_y"], skills: ["Go"], posted: "2026-09-05T00:00:00Z" },
  { id: 9, board: 1, title: "Staff Engineer", company: "Epsilon", location: "Anywhere", tags: ["lead"], skills: ["Java", "Go"], posted: "2026-09-04T00:00:00Z", visa: true },
  { id: 10, board: 2, title: "Remote Bangladesh Friendly Java", company: "Zeta", location: "Remote", remote: true, scope: "anywhere", tags: ["java"], skills: ["Java"], posted: "2026-09-03T00:00:00Z" },
  { id: 11, board: 1, title: "Dev", company: "", location: "Poznań", tags: ["java"], skills: ["Java"], posted: "2026-09-02T00:00:00Z" },
  { id: 12, board: 1, title: "Dev", company: "Eta", location: "Bogotá", tags: ["java"], skills: ["Java"], posted: "2026-09-01T00:00:00Z" },
  { id: 13, board: 1, title: "Dev", company: "Theta", location: "Toronto, Canada / Remote", remote: true, scope: null, tags: ["java"], skills: ["Java", "Java"], posted: "2026-08-30T00:00:00Z" },
  { id: 14, board: 1, title: "Dev", company: "Theta", location: "Dublin", tags: ["spring boot"], skills: [], posted: "2026-08-29T00:00:00Z" },
];


function toListing(f: Fx): FilterableListing {
  const board = BOARDS.find((b) => b.id === f.board)!;
  return {
    id: f.id,
    boardId: f.board,
    boardName: board.name,
    externalId: `e${f.id}`,
    title: f.title,
    company: f.company ?? "",
    location: f.location ?? "",
    isRemote: f.remote ?? false,
    visaSponsorship: f.visa ?? false,
    remoteScope: f.scope ?? null,
    tags: f.tags ?? [],
    skills: f.skills ?? [],
    url: "",
    postedAt: f.posted ?? null,
    deadline: null,
    fetchedAt: f.fetched ?? "2026-09-12T00:00:00Z",
    status: f.status ?? "new",
    userTags: [],
    description: `desc ${f.id}`,
    boardFilterKeywords: board.keywords,
    searchText: [f.title, f.company ?? "", f.location ?? "", ...(f.tags ?? [])].join(" ").toLowerCase(),
  };
}

beforeAll(async () => {
  db = new PGlite();
  for (const file of ["001_baseline.sql", "002_feed_index.sql", "003_country.sql", "004_types.sql"]) {
    await db.exec(readFileSync(join(process.cwd(), "db/migrations", file), "utf8"));
  }
  for (const b of BOARDS) {
    await db.query(
      "insert into boards (id, name, type, url, filter_keywords) overriding system value values ($1,$2,'api','http://x',$3)",
      [b.id, b.name, JSON.stringify(b.keywords)],
    );
  }
  for (const f of FIXTURES) {
    const l = toListing(f);
    await db.query(
      `insert into listings (id, board_id, external_id, title, company, location, is_remote, visa_sponsorship,
         remote_scope, tags, skills, posted_at, fetched_at, status, search_text, description)
       overriding system value values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [l.id, l.boardId, l.externalId, l.title, l.company, l.location, l.isRemote,
        l.visaSponsorship, l.remoteScope, JSON.stringify(l.tags), JSON.stringify(l.skills),
        l.postedAt, l.fetchedAt, l.status, l.searchText, l.description],
    );
  }
  exec = async (text, values) => (await db.query(text, values)).rows as Record<string, unknown>[];
  pool = FIXTURES.map(toListing).sort((a, b) => {
    const ka = a.postedAt ?? a.fetchedAt;
    const kb = b.postedAt ?? b.fetchedAt;
    return ka < kb ? 1 : ka > kb ? -1 : b.id - a.id;
  });
});

afterAll(async () => {
  await db.close();
});

const KW = ["java", "spring boot", "senior", "lead"];

/** Compare SQL view to the in-memory oracle. */
async function expectParity(
  sp: RawParams,
  keywords: string[] = KW,
  opts: { pageSize?: number; bd?: boolean } = {},
) {
  const pageSize = opts.pageSize ?? 3;
  const src = opts.bd ? pool.filter(isBangladeshRelevant) : pool;
  const oracle = buildJobView(src, sp, keywords, { pageSize });
  const got = await runJobQuery(exec, sp, keywords, { pageSize, bd: opts.bd });
  expect(got.entries.map((e) => e.listing.id)).toEqual(oracle.entries.map((e) => e.listing.id));
  expect(got.entries.map((e) => e.matched)).toEqual(oracle.entries.map((e) => e.matched));
  expect(got.entries.map((e) => e.listing.description)).toEqual(oracle.entries.map((e) => e.listing.description));
  expect(got.totalVisible).toBe(oracle.totalVisible);
  expect(got.totalNew).toBe(oracle.totalNew);
  expect(got.currentPage).toBe(oracle.currentPage);
  expect(got.totalPages).toBe(oracle.totalPages);
  expect(got.selections).toEqual(oracle.selections);
  expect(got.facets).toEqual(oracle.facets);
  return got;
}

describe("regex translation", () => {
  it("translates every COUNTRY_FACETS regex and Postgres compiles it", async () => {
    for (const [country, re] of COUNTRY_FACETS) {
      const pg = jsRegexToPg(re.source);
      await expect(db.query("select 'x' ~* $1 as m", [pg]), country).resolves.toBeTruthy();
    }
    await db.query("select 'x' ~* $1", [jsRegexToPg(BD_LOCATION_RE.source)]);
  });

  it("matches JS word-boundary semantics, including accented trailing letters", async () => {
    const pg = jsRegexToPg(/\b(poznań)\b/i.source);
    // JS: \b after the non-word "ń" at end of string does not hold
    expect(/\b(poznań)\b/i.test("Poznań")).toBe(false);
    expect((await db.query("select 'Poznań' ~* $1 as m", [pg])).rows[0]).toEqual({ m: false });
    expect((await db.query("select 'Poznań x' ~* $1 as m", [pg])).rows[0]).toEqual({ m: false });
  });

  it("keyword regex keeps java vs javascript apart", async () => {
    const re = keywordRegexSource("java");
    const m = async (s: string) => (await db.query("select $1::text ~* $2 as m", [s, re])).rows[0];
    expect(await m("javascript dev")).toEqual({ m: false });
    expect(await m("senior java dev")).toEqual({ m: true });
    const cpp = keywordRegexSource("c++");
    expect((await db.query("select 'c++ dev' ~* $1 as m", [cpp])).rows[0]).toEqual({ m: true });
  });

  it("rejects constructs it cannot translate", () => {
    expect(() => jsRegexToPg("(?<n>a)")).toThrow();
    expect(() => jsRegexToPg("\\Bx")).toThrow();
  });

  it("escapes LIKE metacharacters", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });
});

describe("parameterization", () => {
  it("never inlines user input", () => {
    const evil = "x'; drop table listings; --";
    const sp: RawParams = { q: evil, status: evil, skill: [evil], country: [evil], company: [evil], source: [evil] };
    const facet = buildFacetQuery(sp, [evil], new Map([[1, [evil]]]), { pageSize: 3 });
    const page = buildPageQuery(sp, [evil], new Map([[1, [evil]]]), { pageSize: 3 }, 1);
    for (const built of [facet, page]) {
      expect(built.text).not.toContain("drop table");
      expect(built.values.length).toBeGreaterThan(0);
    }
  });
});

describe("SQL feed parity with buildJobView", () => {
  it("no filters", async () => {
    await expectParity({});
  });
  it("paging incl. out-of-range and junk pages", async () => {
    for (const page of ["1", "2", "3", "99", "0", "-4", "abc", "2x"]) await expectParity({ page });
  });
  it("showAll", async () => {
    await expectParity({ showAll: "1" });
    await expectParity({ showAll: "1", page: "2" }, KW, { pageSize: 4 });
  });
  it("no global keywords", async () => {
    await expectParity({}, []);
  });
  it("q substring, case-insensitive, with LIKE metacharacters", async () => {
    for (const q of ["java", "JAVA", "script", "50%", "%", "_", "x_y", "100%", "Match_Case", "c++", "zzz", "spring"]) {
      await expectParity({ q, showAll: "1" });
      await expectParity({ q });
    }
  });
  it("status / remote / visa", async () => {
    for (const status of ["new", "favorite", "applied", "hidden", "bogus"]) await expectParity({ status, showAll: "1" });
    for (const remote of ["1", "anywhere", "restricted", "other"]) {
      await expectParity({ remote });
      await expectParity({ remote, showAll: "1" });
    }
    await expectParity({ visa: "1", showAll: "1" });
    await expectParity({ visa: "1" });
  });
  it("facets, single and multi-select, including values with zero count", async () => {
    await expectParity({ skill: "Java" }, KW);
    await expectParity({ skill: ["Java", "Go"], showAll: "1" });
    await expectParity({ skill: ["Nope"], showAll: "1" });
    await expectParity({ country: "Germany", showAll: "1" });
    await expectParity({ country: ["Germany", "Bangladesh", "Remote · Anywhere", "Other"], showAll: "1" });
    await expectParity({ company: ["Acme", "acme"], showAll: "1" });
    await expectParity({ source: ["Remotive", "BDJobs"], showAll: "1" });
    await expectParity({ source: "RemoteOK", country: ["Poland", "Colombia", "Other"], skill: "Java", showAll: "1" });
  });
  it("combined filters", async () => {
    await expectParity({ q: "dev", remote: "1", visa: "1", skill: ["Python"], source: "Remotive", status: "new" }, []);
    await expectParity({ q: "java", country: ["United States", "Germany"], company: ["Acme", "Beta"] });
  });
  it("global + board keywords (board 2 adds 'visa sponsorship', board 3 adds 'c++')", async () => {
    await expectParity({}, ["engineer"]);
    await expectParity({}, ["  JAVA  ", "", "engineer"]);
    await expectParity({}, ["java", "c++", "50%"]);
    await expectParity({}, ["dev"], { pageSize: 20 });
  });
  it("Bangladesh prefilter", async () => {
    await expectParity({}, KW, { bd: true });
    await expectParity({ showAll: "1" }, KW, { bd: true });
    await expectParity({ showAll: "1", country: "Bangladesh" }, KW, { bd: true });
  });
  it("dedupe keeps the first row in feed order and counts deduped rows", async () => {
    const got = await expectParity({ showAll: "1", q: "java engineer" });
    expect(got.entries.map((e) => e.listing.id)).toEqual([1]);
  });
  it("facet counts are not deduped, hidden rows excluded", async () => {
    const got = await expectParity({ showAll: "1" }, KW, { pageSize: 50 });
    expect(got.entries.some((e) => e.listing.id === 5)).toBe(false);
  });
  it("empty result", async () => {
    const got = await expectParity({ q: "no-such-thing" });
    expect(got.entries).toEqual([]);
    expect(got.totalPages).toBe(1);
  });
  it("facetLimit caps lists but keeps selected values", async () => {
    const got = await runJobQuery(exec, { showAll: "1", skill: "Go" }, KW, { pageSize: 3, facetLimit: 1 });
    const skills = got.facets.find((f) => f.param === "skill")!.values;
    expect(skills.map((v) => v.name)).toContain("Go");
    expect(skills.length).toBeLessThanOrEqual(2);
    const company = got.facets.find((f) => f.param === "company")!.values;
    expect(company).toHaveLength(1);
  });
  it("one page of 20 rows stays small", async () => {
    const got = await runJobQuery(exec, {}, [], { pageSize: 20 });
    expect(JSON.stringify(got).length).toBeLessThan(50_000);
  });
});

import { normaliseParams } from "@/lib/job-query";

describe("normaliseParams (cache key)", () => {
  it("keeps only known, non-empty params", () => {
    const sp = Object.assign(Object.create(null), {
      q: "java", skill: ["a", "b"], junk: "x", status: "", page: "2",
    });
    expect(normaliseParams(sp)).toEqual({ q: "java", skill: ["a", "b"], page: "2" });
  });
  it("takes the first value of repeated scalar params and builds a valid query", () => {
    const n = normaliseParams({ q: ["a", "b"], status: ["new", "x"] } as never);
    expect(n).toEqual({ q: "a", status: "new" });
    expect(() => buildFacetQuery(n, [], new Map(), { pageSize: 20 })).not.toThrow();
  });
  it("caps lengths and counts, drops unknown keys", () => {
    const n = normaliseParams({
      q: "x".repeat(500),
      skill: Array.from({ length: 80 }, (_, i) => "s".repeat(300) + i),
      company: "solo",
      evil: "1",
    } as never);
    expect((n.q as string).length).toBe(200);
    expect(n.skill).toHaveLength(50);
    expect((n.skill as string[])[0].length).toBe(200);
    expect(n.company).toEqual(["solo"]);
    expect("evil" in n).toBe(false);
  });
});

import { backfillCountries } from "@/lib/country-backfill";

describe("country backfill", () => {
  it("fills country in batches, then feed results still match the oracle", async () => {
    const total = FIXTURES.length;
    expect(await backfillCountries(exec, 2)).toBe(total);
    expect(await backfillCountries(exec, 2)).toBe(0);
    const rows = await exec("select id, country from listings order by id", []);
    for (const f of FIXTURES) {
      const l = toListing(f);
      const want = countryFacetValue({ location: l.location, isRemote: l.isRemote, remoteScope: l.remoteScope });
      expect(rows.find((r) => Number(r.id) === f.id)?.country, String(f.id)).toBe(want);
    }
    // country now precomputed for every row: parity unchanged
    await expectParity({});
    await expectParity({ country: ["Germany", "Other"] });
    await expectParity({ country: ["Bangladesh"] }, KW, { bd: true });
  });
});

describe("driver-safe JSON params", () => {
  // postgres.js infers a jsonb-typed param from a bare `$n::jsonb` and
  // JSON-encodes the (already stringified) list again → a scalar, not an
  // array ("cannot extract elements from a scalar"). PGlite doesn't, so
  // guard the SQL shape instead.
  it("casts list params through text", () => {
    const sp: RawParams = { skill: ["Java"], country: "Germany", company: "Acme", source: "X" };
    const { text } = buildFacetQuery(sp, [], new Map(), { pageSize: 20, facetLimit: 10 });
    expect(text).not.toMatch(/\$\d+::jsonb/);
    expect(text).toMatch(/\$\d+::text::jsonb/);
  });
});
