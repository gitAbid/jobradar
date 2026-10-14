import { z } from "zod";
import { cacheLife, cacheTag } from "next/cache";
import { remoteQuery } from "@/db/remote";
import { COUNTRY_FACETS, topValues } from "@/lib/facets";
import { BD_LOCATION_RE } from "@/lib/bd";
import { matchedKeywords } from "@/lib/filters";
import type { FacetParam, JobEntry, JobView, RawParams } from "@/lib/job-view";
import type { FilterableListing, ListingStatus } from "@/lib/types";

/**
 * SQL-side feed query builder: one page of rows + aggregated facet counts
 * instead of the whole table. It reproduces the in-memory pipeline in
 * `buildJobView` (the parity oracle, see tests/job-query.test.ts):
 * hidden rows excluded, status/remote/visa, cascading facets (each facet
 * ignores its own selection), q substring, global+board keyword regexes,
 * company|title dedupe and clamped paging.
 *
 * Pure builders return `{text, values}`; `runJobQuery` takes an executor
 * `(text, values) => rows`, so tests run it on PGlite and prod on Neon.
 * Every user-controlled value travels as a parameter. Only static constants
 * (country names / regex sources from COUNTRY_FACETS and bd.ts) are inlined,
 * via `sqlLiteral`.
 */

export type SqlExec = (
  text: string,
  values: unknown[],
) => Promise<Record<string, unknown>[]>;

export interface BuiltQuery {
  text: string;
  values: unknown[];
}

export interface JobQueryOpts {
  pageSize: number;
  /** restrict to Bangladesh-relevant rows (mirrors bd.ts `isBangladeshRelevant`) */
  bd?: boolean;
  /** cap per facet (selected values are always kept). Unset = all values, like the in-memory oracle. */
  facetLimit?: number;
}

const FACET_PARAMS: FacetParam[] = ["skill", "country", "company", "source"];

// ── regex translation (JS → Postgres ARE) ──────────────────────────────────

const W = "A-Za-z0-9_"; // JS `\w` is ASCII-only
/**
 * JS `\b` as ARE lookarounds. Postgres `\y` treats accented letters as word
 * characters (e.g. the trailing "á" of "bogotá"), JS does not, so `\y` would
 * not be an exact translation.
 */
const JS_WORD_BOUNDARY = `(?:(?<=[${W}])(?![${W}])|(?<![${W}])(?=[${W}]))`;

/** Translate a JS RegExp source to an equivalent Postgres ARE (throws on anything unsupported). */
export function jsRegexToPg(source: string): string {
  let out = "";
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") {
      const next = source[i + 1];
      if (next === undefined) throw new Error("dangling backslash in regex");
      if (next === "b") {
        if (inClass) throw new Error("\\b inside a character class is not translatable");
        out += JS_WORD_BOUNDARY;
      } else if (next === "B" || next === "k" || next === "u" || next === "c" || next === "p" || next === "P") {
        throw new Error(`regex escape \\${next} is not translatable`);
      } else {
        out += c + next;
      }
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
    } else if (c === "[") {
      inClass = true;
    } else if (c === "(" && source[i + 1] === "?" && !/[:=!]/.test(source[i + 2] ?? "")) {
      // named groups / lookbehind variants differ between engines
      if (!(source[i + 2] === "<" && /[=!]/.test(source[i + 3] ?? ""))) {
        throw new Error("regex group syntax is not translatable");
      }
    }
    out += c;
  }
  return out;
}

/** The ARE source of `keywordRegex(keyword)` in filters.ts (keyword already trimmed/lowercased). */
export function keywordRegexSource(keyword: string): string {
  const esc = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pre = /^\w/.test(keyword) ? JS_WORD_BOUNDARY : "";
  const post = /\w$/.test(keyword) ? JS_WORD_BOUNDARY : "";
  return `${pre}${esc}${post}`;
}

function normalizeKeywords(keywords: string[]): string[] {
  return [...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))];
}

/** One regex matching any of the keywords; "" (matches everything) when there are none. */
function combinedKeywordRegex(keywords: string[]): string {
  const ks = normalizeKeywords(keywords);
  if (ks.length === 0) return "";
  return ks.map((k) => `(?:${keywordRegexSource(k)})`).join("|");
}

/** Escape LIKE/ILIKE metacharacters (default escape char is backslash). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** Inline a STATIC string constant. Never use with user input. */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** SQL CASE mirroring `countryFacetValue` over columns `location`, `is_remote`, `remote_scope`. */
export function countryCaseSql(loc = "l.location"): string {
  const whens = COUNTRY_FACETS.map(
    ([country, re]) => `when ${loc} ~* ${sqlLiteral(jsRegexToPg(re.source))} then ${sqlLiteral(country)}`,
  );
  return `case ${whens.join(" ")}
    when (l.is_remote and l.remote_scope = 'anywhere') or ${loc} ~* 'remote|anywhere' then 'Remote · Anywhere'
    else 'Other' end`;
}

/** Bangladesh relevance, exact (location regex, or "bangladesh" in title/search_text). */
function bdWhereSql(): string {
  return `(l.location ~* ${sqlLiteral(jsRegexToPg(BD_LOCATION_RE.source))}
    or (l.title || ' ' || l.search_text) ~* ${sqlLiteral(`${JS_WORD_BOUNDARY}bangladesh`)})`;
}

// ── builder ────────────────────────────────────────────────────────────────

export type BoardKeywords = Map<number, string[]>;

function asArray(value?: string | string[]): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
  /**
   * string[] bound as one JSON text parameter (works on any driver, no array
   * typing). Cast via text: a bare `$n::jsonb` makes postgres.js infer a jsonb
   * param and JSON-encode the string again, yielding a scalar, not an array.
   */
  json(list: string[]): string {
    return `${this.add(JSON.stringify(list))}::text::jsonb`;
  }
}

interface Built {
  /** `with base as (...)` prefix and the predicate builder */
  withBase: string;
  where: (exclude?: FacetParam) => string;
  selections: Record<FacetParam, string[]>;
  params: Params;
}

function build(
  sp: RawParams,
  globalKeywords: string[],
  boardKeywords: BoardKeywords,
  opts: JobQueryOpts,
  userId: string | null,
): Built {
  const p = new Params();
  // per-user state; null (signed out) matches no state rows → every status is 'new'
  const uid = p.add(userId);
  const selections: Record<FacetParam, string[]> = {
    skill: asArray(sp.skill),
    country: asArray(sp.country),
    company: asArray(sp.company),
    source: asArray(sp.source),
  };

  const rest: string[] = ["x.status <> 'hidden'"];
  if (sp.status) rest.push(`x.status = ${p.add(sp.status)}::text`);
  if (sp.remote === "1") rest.push("x.is_remote");
  else if (sp.remote === "anywhere") rest.push("(x.is_remote and x.remote_scope = 'anywhere')");
  else if (sp.remote === "restricted") rest.push("(x.is_remote and x.remote_scope = 'restricted')");
  if (sp.visa === "1") rest.push("x.visa_sponsorship");

  if (sp.q) {
    const pat = p.add(`%${escapeLike(sp.q)}%`);
    rest.push(`(x.title ilike ${pat}::text
      or x.company ilike ${pat}::text
      or x.location ilike ${pat}::text
      or exists (select 1 from jsonb_array_elements_text(x.tags) t where t ilike ${pat}::text)
      or exists (select 1 from jsonb_array_elements_text(x.skills) s where s ilike ${pat}::text))`);
  }

  // global keyword filter (skipped by "Show all"): global ∪ per-board keywords
  if (sp.showAll !== "1") {
    const globalRe = combinedKeywordRegex(globalKeywords);
    const overrides: string[] = [];
    for (const [boardId, kws] of boardKeywords) {
      const re = combinedKeywordRegex([...globalKeywords, ...kws]);
      if (re !== globalRe) overrides.push(`when ${p.add(boardId)}::int then ${p.add(re)}::text`);
    }
    if (globalRe !== "" || overrides.length > 0) {
      const globalParam = `${p.add(globalRe)}::text`;
      rest.push(
        overrides.length
          ? `x.hay ~* (case x.board_id ${overrides.join(" ")} else ${globalParam} end)`
          : `x.hay ~* ${globalParam}`,
      );
    }
  }

  const facetPred: Record<FacetParam, string | null> = {
    skill: selections.skill.length
      ? `exists (select 1 from jsonb_array_elements_text(x.skills) s
           where s in (select jsonb_array_elements_text(${p.json(selections.skill)})))`
      : null,
    country: selections.country.length
      ? `x.country in (select jsonb_array_elements_text(${p.json(selections.country)}))`
      : null,
    company: selections.company.length
      ? `x.company in (select jsonb_array_elements_text(${p.json(selections.company)}))`
      : null,
    source: selections.source.length
      ? `x.board_name in (select jsonb_array_elements_text(${p.json(selections.source)}))`
      : null,
  };

  const where = (exclude?: FacetParam): string => {
    const preds = [...rest];
    for (const param of FACET_PARAMS) {
      if (param === exclude) continue;
      const f = facetPred[param];
      if (f) preds.push(f);
    }
    return preds.join(" and ");
  };

  const withBase = `with base as (
    select l.id, l.board_id, l.title, l.company, l.location, l.is_remote,
      l.visa_sponsorship, l.remote_scope, l.tags, l.skills, l.url, l.external_id,
      l.posted_at, l.deadline, l.fetched_at,
      coalesce(s.status, 'new') as status,
      coalesce(s.user_tags, '[]'::jsonb) as user_tags,
      b.name as board_name, b.filter_keywords as board_filter_keywords,
      coalesce(l.posted_at, l.fetched_at) as sort_at,
      lower(l.company || '|' || l.title) as dk,
      coalesce(l.country, ${countryCaseSql()}) as country,
      (l.title || ' ' || l.company || ' ' || l.location || ' ' ||
        array_to_string(array(select jsonb_array_elements_text(l.tags)), ' ')) as hay
    from listings l join boards b on b.id = l.board_id
    left join user_listing_state s on s.listing_id = l.id and s.user_id = ${uid}::uuid
    ${opts.bd ? `where ${bdWhereSql()}` : ""}
  )`;

  return { withBase, where, selections, params: p };
}

/** Predicates and aggregations all read the flat `base` CTE through alias x. */
function fromBase(): string {
  return "from base x";
}

/** Facet counts + totals in one statement. Rows: {k, name, n}. */
export function buildFacetQuery(
  sp: RawParams,
  globalKeywords: string[],
  boardKeywords: BoardKeywords,
  opts: JobQueryOpts,
  userId: string | null = null,
): BuiltQuery {
  const { withBase, where, selections, params } = build(sp, globalKeywords, boardKeywords, opts, userId);

  const parts = [
    `select 'skill' as k, s.name, count(*)::int as n
       ${fromBase()}, jsonb_array_elements_text(x.skills) as s(name)
       where ${where("skill")} group by s.name`,
    `select 'country', x.country, count(*)::int
       ${fromBase()} where ${where("country")} group by x.country`,
    `select 'company', x.company, count(*)::int
       ${fromBase()} where x.company <> '' and ${where("company")} group by x.company`,
    `select 'source', x.board_name, count(*)::int
       ${fromBase()} where x.board_name <> '' and ${where("source")} group by x.board_name`,
    `select 'total', null, count(*)::int from (
       select distinct on (x.dk) x.id ${fromBase()} where ${where()}) d`,
    `select 'new', null, count(*)::int ${fromBase()} where x.status = 'new'`,
  ];
  const union = parts.join("\n union all\n ");

  let text: string;
  if (opts.facetLimit !== undefined) {
    const limit = params.add(opts.facetLimit);
    const keep = (k: FacetParam) =>
      selections[k].length
        ? `or (u.k = '${k}' and u.name in (select jsonb_array_elements_text(${params.json(selections[k])})))`
        : "";
    text = `${withBase}
      select k, name, n from (
        select u.*, row_number() over (partition by u.k order by u.n desc, u.name) as rn from (
          ${union}
        ) u
      ) u
      where u.k in ('total', 'new') or u.rn <= ${limit}::int
        ${FACET_PARAMS.map(keep).join(" ")}`;
  } else {
    text = `${withBase}\n${union}`;
  }
  return { text, values: params.values };
}

/** One deduped page of rows (with description for those rows only). */
export function buildPageQuery(
  sp: RawParams,
  globalKeywords: string[],
  boardKeywords: BoardKeywords,
  opts: JobQueryOpts,
  page: number,
  userId: string | null = null,
): BuiltQuery {
  const { withBase, where, params } = build(sp, globalKeywords, boardKeywords, opts, userId);
  const limit = params.add(opts.pageSize);
  const offset = params.add((page - 1) * opts.pageSize);
  const text = `${withBase},
    d as (
      select distinct on (x.dk) x.* ${fromBase()} where ${where()}
      order by x.dk, x.sort_at desc, x.id desc
    )
    select d.id, d.board_id, d.external_id, d.title, d.company, d.location, d.is_remote,
      d.visa_sponsorship, d.remote_scope, d.tags, d.skills, d.url, d.posted_at, d.deadline,
      d.fetched_at, d.status, d.user_tags, d.board_name, d.board_filter_keywords, ds.description
    from d join listings ds on ds.id = d.id
    order by d.sort_at desc, d.id desc
    limit ${limit}::int offset ${offset}::int`;
  return { text, values: params.values };
}

// ── execution ──────────────────────────────────────────────────────────────

function isoOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return String(v);
}

function parseStringArray(json: unknown): string[] {
  if (typeof json !== "string") return Array.isArray(json) ? json.map(String) : [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Row (pg snake_case, jsonb columns) → FilterableListing. `searchText` is not selected. */
export function rowToFeedListing(r: Record<string, unknown>): FilterableListing {
  return {
    id: Number(r.id),
    boardId: Number(r.board_id),
    boardName: String(r.board_name ?? ""),
    externalId: String(r.external_id ?? ""),
    title: String(r.title),
    company: String(r.company ?? ""),
    location: String(r.location ?? ""),
    isRemote: r.is_remote === true,
    visaSponsorship: r.visa_sponsorship === true,
    remoteScope: (r.remote_scope as "anywhere" | "restricted" | null) ?? null,
    tags: parseStringArray(r.tags),
    skills: parseStringArray(r.skills),
    url: String(r.url ?? ""),
    postedAt: isoOrNull(r.posted_at),
    deadline: isoOrNull(r.deadline),
    fetchedAt: isoOrNull(r.fetched_at) ?? "",
    status: (r.status as ListingStatus | undefined) ?? "new",
    userTags: parseStringArray(r.user_tags),
    description: typeof r.description === "string" ? r.description : "",
    boardFilterKeywords: parseStringArray(r.board_filter_keywords),
    searchText: "",
  };
}

const FACET_TITLES: Record<FacetParam, string> = {
  skill: "Skills",
  country: "Country",
  company: "Company",
  source: "Source",
};

/** Board id → its extra filter keywords (a tiny table). */
async function loadBoardKeywords(exec: SqlExec): Promise<BoardKeywords> {
  const rows = await exec("select id, filter_keywords from boards", []);
  return new Map(rows.map((r) => [Number(r.id), parseStringArray(r.filter_keywords)]));
}

/** Two round trips after the (tiny) boards lookup: facets+totals, then the page. */
export async function runJobQuery(
  exec: SqlExec,
  sp: RawParams,
  globalKeywords: string[],
  opts: JobQueryOpts,
  userId: string | null = null,
): Promise<JobView> {
  const boardKeywords = await loadBoardKeywords(exec);

  const facetQ = buildFacetQuery(sp, globalKeywords, boardKeywords, opts, userId);
  const facetRows = await exec(facetQ.text, facetQ.values);

  const counts: Record<FacetParam, Map<string, number>> = {
    skill: new Map(),
    country: new Map(),
    company: new Map(),
    source: new Map(),
  };
  let totalVisible = 0;
  let totalNew = 0;
  for (const r of facetRows) {
    const k = String(r.k);
    const n = Number(r.n);
    if (k === "total") totalVisible = n;
    else if (k === "new") totalNew = n;
    else if (k in counts) counts[k as FacetParam].set(String(r.name), n);
  }

  const selections: Record<FacetParam, string[]> = {
    skill: asArray(sp.skill),
    country: asArray(sp.country),
    company: asArray(sp.company),
    source: asArray(sp.source),
  };
  const facets = FACET_PARAMS.map((param) => {
    const values = topValues(counts[param]);
    // keep the user's chosen values visible even at zero count elsewhere
    for (const s of selections[param]) {
      if (!values.some((v) => v.name === s)) values.push({ name: s, count: 0 });
    }
    return { title: FACET_TITLES[param], param, values };
  });

  const totalPages = Math.max(1, Math.ceil(totalVisible / opts.pageSize));
  const requestedPage = Number.parseInt(sp.page ?? "1", 10);
  const currentPage = Math.min(
    Math.max(Number.isNaN(requestedPage) ? 1 : requestedPage, 1),
    totalPages,
  );

  let entries: JobEntry[] = [];
  if (totalVisible > 0) {
    const pageQ = buildPageQuery(sp, globalKeywords, boardKeywords, opts, currentPage, userId);
    const rows = await exec(pageQ.text, pageQ.values);
    entries = rows.map((row) => {
      const listing = rowToFeedListing(row);
      return { listing, matched: matchedKeywords(listing, globalKeywords) };
    });
  }

  return { entries, totalVisible, totalNew, currentPage, totalPages, selections, facets };
}

/**
 * One listing by id, with description (null when absent). Shared data only:
 * status is always "new" and userTags empty — per-user state is never part of
 * this (cached) lookup; see `fetchUserListingState`.
 */
export async function fetchListingById(
  exec: SqlExec,
  id: number,
): Promise<FilterableListing | null> {
  const rows = await exec(
    `select l.id, l.board_id, l.external_id, l.title, l.company, l.location, l.is_remote,
       l.visa_sponsorship, l.remote_scope, l.tags, l.skills, l.url, l.posted_at, l.deadline,
       l.fetched_at, l.description,
       b.name as board_name, b.filter_keywords as board_filter_keywords
     from listings l join boards b on b.id = l.board_id
     where l.id = $1::int`,
    [id],
  );
  return rows[0] ? rowToFeedListing(rows[0]) : null;
}

/** One user's state for one listing (uncached; defaults when no row). */
export async function fetchUserListingState(
  exec: SqlExec,
  userId: string,
  listingId: number,
): Promise<{ status: ListingStatus; userTags: string[] }> {
  const rows = await exec(
    "select status, user_tags from user_listing_state where user_id = $1::uuid and listing_id = $2::int",
    [userId, listingId],
  );
  const r = rows[0];
  return {
    status: (r?.status as ListingStatus | undefined) ?? "new",
    userTags: parseStringArray(r?.user_tags),
  };
}

// ── Shared cache (Next 16 Cache Components) ────────────────────────────────

const SCALAR_KEYS = ["status", "remote", "visa", "showAll", "q", "page"] as const;
const MAX_VALUE_LEN = 200;
const MAX_FACET_VALUES = 50;

// Coerce, never throw: scalars take the first value of a repeated param,
// facets are capped string arrays; anything else is dropped.
const scalarParam = z.preprocess(
  (v) => (Array.isArray(v) ? v[0] : v),
  z.string().transform((s) => s.slice(0, MAX_VALUE_LEN)),
);
const facetParam = z.preprocess(
  (v) => (typeof v === "string" ? [v] : v),
  z
    .array(z.unknown())
    .transform((a) =>
      a
        .filter((x): x is string => typeof x === "string" && x !== "")
        .slice(0, MAX_FACET_VALUES)
        .map((x) => x.slice(0, MAX_VALUE_LEN)),
    ),
);

/**
 * Whitelist + canonicalise filter params so the cache key is built from
 * serializable, known keys only (searchParams may carry junk, repeated
 * params or a null-prototype object). Never throws.
 */
export function normaliseParams(sp: RawParams): RawParams {
  const out: Record<string, string | string[]> = {};
  const src = sp as Record<string, unknown>;
  for (const k of SCALAR_KEYS) {
    const r = scalarParam.safeParse(src[k]);
    if (r.success && r.data !== "") out[k] = r.data;
  }
  for (const k of FACET_PARAMS) {
    const r = facetParam.safeParse(src[k]);
    if (r.success && r.data.length > 0) out[k] = r.data;
  }
  return out as RawParams;
}

/** Backstop only: the `listings` tag is the primary freshness signal. */
const LISTINGS_LIFE = { stale: 60, revalidate: 15 * 60, expire: 24 * 60 * 60 };

/** Counts the listings SQL that actually reaches Neon (cache misses). */
function loggedRemote(label: string): SqlExec {
  if (process.env.NODE_ENV !== "production" || process.env.JOBRADAR_LOG_SQL === "1") {
    console.log(`[jobradar] feed SQL (${label})`);
  }
  return (text, values) => remoteQuery(text, values);
}

/**
 * Feed page + facets, cached under the `listings` tag AND the caller's
 * `user-state:<id>` tag. Arguments are the cache key, so `userId` makes every
 * entry per-user (never served across users). Resolve the user OUTSIDE this
 * function: auth() must not run inside `'use cache'`.
 */
export async function getCachedJobView(
  userId: string | null,
  sp: RawParams,
  globalKeywords: string[],
  opts: JobQueryOpts,
): Promise<JobView> {
  "use cache: remote";
  cacheLife(LISTINGS_LIFE);
  cacheTag("listings", `user-state:${userId ?? "anon"}`);
  return runJobQuery(loggedRemote("page"), sp, globalKeywords, opts, userId);
}

export async function getCachedListingById(id: number): Promise<FilterableListing | null> {
  "use cache: remote";
  cacheLife(LISTINGS_LIFE);
  cacheTag("listings");
  return fetchListingById(loggedRemote("by-id"), id);
}
