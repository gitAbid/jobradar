import Parser from "rss-parser";
import type { Board, NormalizedListing } from "@/lib/types";
import {
  normalizeAirwork,
  normalizeArbeitnow,
  normalizeBdjobs,
  normalizeGreenhouse,
  normalizeHimalayas,
  normalizeJapanDev,
  normalizeRemoteOk,
  normalizeRemotive,
  normalizeSmartRecruiters,
  normalizeTalvette,
  normalizeTekarsh,
  normalizeWorkingNomads,
  normalizeJobicy,
  normalizeReed,
  parseReedDetail,
  detectVisaSponsorship,
  detectRemoteScope,
  extractFeedExtras,
  idFromUrl,
  parseJapanDevDetail,
  capDescription,
} from "@/lib/adapters/normalize";
import { decodeEntities, isTechTitle, parseArcJobs, parseArcDetail, parseEasyJobsApi, parseNextJobzDetail, parseNextJobzRsc, parseNextJobzSitemap, parseRelocateMe, parseRelocateMeDetail, parseRiseupLabs, parseRiseupLabsDetail, parseSkillJobs, parseSkillJobsDetail, parseTokyoDev, parseTokyoDevDetail, filterTechUrls } from "@/lib/adapters/scrape";
import { knownEnrichedExternalIds, persistEnrichment, q } from "@/db";
import type { EnrichPatch } from "@/db";
import { buildSearchText } from "@/lib/filters";
import { extractSkills } from "@/lib/skills";

const TIMEOUT_MS = 15_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) JobRadar/1.0 (+https://localhost)";

/**
 * Wall-clock budget for browser-based detail enrichment. Serverless
 * refreshes cap at 60s (maxDuration), so enrichment must fit inside a safe
 * slice of one invocation; local runs are uncapped.
 */
function enrichStopAt(): number {
  return process.env.VERCEL === "1" ? Date.now() + 35_000 : Number.POSITIVE_INFINITY;
}

/** Standard enrichment payload persisted back onto stored rows. */
function toPatch(l: NormalizedListing, extra: Partial<EnrichPatch> = {}): EnrichPatch {
  return {
    externalId: l.externalId,
    searchText: buildSearchText({
      title: l.title,
      company: l.company,
      location: l.location,
      tags: l.tags,
      description: l.description,
    }),
    skills: JSON.stringify(extractSkills({ title: l.title, tags: l.tags, description: l.description })),
    description: capDescription(l.description),
    ...extra,
  };
}

/** fetch JSON with timeout + one retry; throws on failure */
async function fetchJson(url: string): Promise<unknown> {
  const text = await fetchText(url);
  return JSON.parse(text);
}

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json, text/xml, */*", ...headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ── RSS ────────────────────────────────────────────────────────────────────

const parser = new Parser({
  customFields: { item: [["content:encoded", "contentEncoded"]] },
});

interface RssItemLike {
  title?: string;
  link?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  contentEncoded?: string;
  categories?: string[];
}

export async function fetchRss(
  board: Pick<Board, "id" | "name" | "type" | "url">,
): Promise<NormalizedListing[]> {
  const xml = await fetchText(board.url);
  const feed = await parser.parseString(xml);
  const items = (feed.items ?? []) as RssItemLike[];
  return items.map((item) => {
    // WWR titles look like "Company: Role title"
    let company = "";
    let title = String(item.title ?? "").trim();
    const idx = title.indexOf(": ");
    if (idx > 0 && idx < 60) {
      company = title.slice(0, idx).trim();
      title = title.slice(idx + 2).trim();
    }
    const description = String(
      item.contentEncoded ?? item.content ?? item.contentSnippet ?? "",
    );
    // company career feeds label location/deadline inside the content —
    // remote-board feeds don't, and keep the legacy all-remote defaults
    const extras = extractFeedExtras(title, description);
    return {
      externalId: String(item.guid ?? item.link ?? idFromUrl(title)),
      title,
      company,
      location: extras?.location ?? "Remote",
      isRemote: extras ? extras.isRemote : true,
      visaSponsorship: detectVisaSponsorship(description, title),
      tags: Array.isArray(item.categories) ? item.categories.map(String) : [],
      url: String(item.link ?? ""),
      postedAt: item.isoDate ?? item.pubDate ?? null,
      deadline: extras?.deadline ?? null,
      description: decodeEntities(
        description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      ),
    } satisfies NormalizedListing;
  });
}

// ── API adapters dispatch ──────────────────────────────────────────────────

type Normalizer = (payload: unknown) => NormalizedListing[];

const API_NORMALIZERS: Record<string, Normalizer> = {
  remoteok: normalizeRemoteOk,
  remotive: normalizeRemotive,
  arbeitnow: normalizeArbeitnow,
  himalayasapp: normalizeHimalayas,
  workingnomads: normalizeWorkingNomads,
  jobicy: normalizeJobicy,
};

function pickNormalizer(boardName: string): Normalizer | null {
  return API_NORMALIZERS[boardName.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
}

/** Word-boundary keyword test used to pre-filter company career boards. */
function matchesAnyKeyword(haystack: string, keywords: string[]): boolean {
  return keywords.some((k) => {
    const esc = k.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!esc) return false;
    const pre = /^\w/.test(esc) ? "\\b" : "";
    const post = /\w$/.test(esc) ? "\\b" : "";
    return new RegExp(`${pre}${esc}${post}`, "i").test(haystack);
  });
}

export async function fetchBoardListings(
  board: Pick<Board, "id" | "name" | "type" | "url" | "filterKeywords">,
): Promise<NormalizedListing[]> {
  let listings =
    board.type === "rss"
      ? await fetchRss(board)
      : board.type === "greenhouse"
        ? await fetchGreenhouse(board)
        : board.type === "scrape"
          ? await fetchScraped(board)
          : await fetchApiListings(board);

  // Company career boards post hundreds of irrelevant roles — keep only
  // listings matching the board's filter keywords (title or description).
  if (board.type === "greenhouse" && board.filterKeywords.length > 0) {
    listings = listings.filter(
      (l) => matchesAnyKeyword(`${l.title} ${l.description}`, board.filterKeywords),
    );
  }

  // single-company RSS feeds don't name the company per item — the board does
  if (board.type === "rss") {
    listings = listings.map((l) => ({
      ...l,
      company: l.company || board.name.replace(/ \(careers\)$/i, ""),
    }));
  }

  // classify remote scope centrally once fields are normalized
  return listings.map((l) => ({
    ...l,
    remoteScope: detectRemoteScope({
      isRemote: l.isRemote,
      location: l.location,
      description: l.description,
    }),
  }));
}

/** Greenhouse company board: the board IS the company. */
async function fetchGreenhouse(
  board: Pick<Board, "name" | "url">,
): Promise<NormalizedListing[]> {
  const payload = await fetchJson(board.url);
  return normalizeGreenhouse(payload).map((l) => ({
    ...l,
    company: l.company || board.name.replace(/ \(careers\)$/i, ""),
  }));
}

/**
 * Cefalo's career site is a Next.js app with server-rendered listing and
 * detail pages — plain fetch works, no headless browser needed (so the
 * board also runs on serverless). Listing anchors: /job/{slug}; the slug
 * carries the title (id suffix stripped).
 */
async function fetchCefalo(board: Pick<Board, "id" | "name" | "url">): Promise<NormalizedListing[]> {
  const html = await fetchText(board.url);
  const origin = new URL(board.url).origin;
  const slugs = [
    ...new Set(
      [...html.matchAll(/href="(\/job\/([a-z0-9-]+))"/g)].map((m) => m[1] as string),
    ),
  ];
  const listings = slugs.map((path) => {
    const slug = path.replace("/job/", "");
    // slug format: fullstack-python-developer-lead-architect-35 → title minus trailing id
    const title = slug
      .replace(/-\d+$/, "")
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return {
      externalId: slug,
      title,
      company: "Cefalo",
      location: "Dhaka, Bangladesh",
      isRemote: /remote/i.test(slug),
      visaSponsorship: false,
      tags: [],
      url: `${origin}${path}`,
      postedAt: null,
      description: "",
    } satisfies NormalizedListing;
  });

  // ── enrich descriptions via server-rendered detail pages ────────────────
  // The full JD is the detail page's visible text. Bounded like the other
  // adapters; rows that already carry a description are skipped so each
  // refresh advances.
  const knownEnriched = await knownEnrichedExternalIds(board.id, "description");
  let enriched = 0;
  for (const l of listings) {
    if (enriched >= 5) break;
    if (knownEnriched.has(l.externalId)) continue;
    try {
      const text = (await fetchText(l.url))
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/^[\s\S]*?Back to job list/i, "")
        .replace(/Copyright ©[\s\S]*$/i, "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length < 300) continue; // nav/challenge shell only
      l.description = text;
      enriched++;
    } catch {
      // detail fetch failed — retry next refresh
    }
  }
  if (enriched > 0) {
    await persistEnrichment(
      board.id,
      listings.filter((l) => l.description).map((l) => toPatch(l)),
    );
    console.log(`[jobradar] cefalo: enriched ${enriched} descriptions via detail pages`);
  }

  return listings;
}

/** HTML scrapers + reverse-engineered JSON APIs for BD sources. */
async function fetchScraped(
  board: Pick<Board, "id" | "name" | "url">,
): Promise<NormalizedListing[]> {  const host = new URL(board.url).host;
  let listings: NormalizedListing[];
  if (host.endsWith("easy.jobs")) {
    listings = await fetchEasyJobs(board);
  } else if (host.endsWith("tokyodev.com")) {
    listings = await fetchTokyoDev(board);
  } else if (host === "arc.dev") {
    listings = await fetchArc(board);
  } else if (host.endsWith("relocate.me")) {
    listings = await fetchRelocateMe(board);
  } else if (host.endsWith("nextjobz.com.bd")) {
    listings = await fetchNextJobz(board);
  } else if (host === "career.cefalo.com") {
    listings = await fetchCefalo(board);
  } else if (host.endsWith("riseuplabs.com")) {
    listings = await fetchRiseupLabs(board);
  } else if (host === "skill.jobs") {
    listings = await fetchSkillJobs(board);
  } else if (host === "ignition.airwork.ai") {
    // Airwork public API: skip-based pagination, 50 per page
    listings = [];
    const seen = new Set<string>();
    for (let skip = 0; skip < 250; skip += 50) {
      const payload = await fetchJson(
        `${board.url}${board.url.includes("?") ? "&" : "?"}limit=50&skip=${skip}`,
      );
      let fresh = 0;
      for (const l of normalizeAirwork(payload)) {
        if (!seen.has(l.externalId)) {
          seen.add(l.externalId);
          listings.push(l);
          fresh++;
        }
      }
      if (fresh === 0) break;
    }
  } else if (host.endsWith("sheety.co")) {
    listings = normalizeTalvette(await fetchJson(board.url));
  } else {
    throw new Error(`no scraper available for ${host}`);
  }
  return listings.map((l) => ({
    ...l,
    company: l.company || board.name.replace(/ \(careers\)$/i, ""),
  }));
}

/**
 * easy.jobs tenant boards. The career pages are a client-rendered SPA, so
 * job data is read from the JSON API the site itself calls
 * (GET {origin}/api/career/home — see parseEasyJobsApi). The JD HTML comes
 * inline per job, so no detail-page enrichment is needed.
 */
async function fetchEasyJobs(board: Pick<Board, "id" | "name" | "url">): Promise<NormalizedListing[]> {
  const origin = new URL(board.url).origin;
  return parseEasyJobsApi(await fetchJson(`${origin}/api/career/home`), origin);
}

/**
 * TokyoDev's listing page is server-rendered and fetchable without a browser
 * (Cloudflare only guards /api/* and detail pages). Descriptions only exist
 * on detail pages, which DO require headless Chromium — enrich up to 20 new
 * jobs per refresh by extracting the JSON-LD JobPosting each page embeds.
 */
async function fetchTokyoDev(board: Pick<Board, "id" | "name" | "url">): Promise<NormalizedListing[]> {
  const listings = parseTokyoDev(await fetchText(board.url));

  const knownEnriched = await knownEnrichedExternalIds(board.id, "skills");

  const { renderPage } = await import("@/lib/adapters/browser");
  let enriched = 0;
  let firstFailure: string | undefined;
  const stopAt = enrichStopAt();
  for (const l of listings) {
    if (enriched >= 20 || Date.now() >= stopAt) break;
    if (knownEnriched.has(l.externalId)) continue;
    try {
      const detail = parseTokyoDevDetail(await renderPage(l.url, 3500));
      if (!detail) continue;
      l.description = detail.description;
      if (detail.postedAt) l.postedAt = detail.postedAt;
      if (detail.location) l.location = `${detail.location}, Japan`;
      enriched++;
    } catch (e) {
      // Cloudflare challenge or timeout — try again next refresh
      firstFailure ??= e instanceof Error ? e.message : String(e);
    }
  }
  if (firstFailure) {
    console.error(`[jobradar] tokyodev: enrichment failing (${firstFailure})`);
  }
  if (enriched > 0) {
    await persistEnrichment(
      board.id,
      listings
        .filter((l) => l.description)
        .map((l) => toPatch(l, { location: l.location, postedAt: l.postedAt })),
    );
    console.log(`[jobradar] tokyodev: enriched ${enriched} descriptions via detail pages`);
  }

  return listings;
}

/**
 * riseuplabs.com/jobs: listing page AND detail pages are server-rendered.
 * Descriptions live on each /jobs/{slug}/ page — enrich up to 10 new jobs
 * per refresh; rows that already carry a description are skipped so each
 * refresh advances. Deadlines come straight from the listing meta.
 */
async function fetchRiseupLabs(board: Pick<Board, "id" | "name" | "url">): Promise<NormalizedListing[]> {
  const listings = parseRiseupLabs(await fetchText(board.url));

  const knownEnriched = await knownEnrichedExternalIds(board.id, "description");

  let enriched = 0;
  for (const l of listings) {
    if (enriched >= 10) break;
    if (knownEnriched.has(l.externalId)) continue;
    try {
      const description = parseRiseupLabsDetail(await fetchText(l.url));
      if (!description) continue;
      l.description = description;
      enriched++;
    } catch {
      // detail fetch failed — try again next refresh
    }
  }
  if (enriched > 0) {
    await persistEnrichment(
      board.id,
      listings.filter((l) => l.description).map((l) => toPatch(l)),
    );
    console.log(`[jobradar] riseuplabs: enriched ${enriched} descriptions via detail pages`);
  }

  return listings;
}

/**
 * skill.jobs is a general BD job portal whose listing page embeds the newest
 * ~25 jobs as schema.org JobPosting objects. Titles are filtered to tech
 * roles; each job names its real hiring company, so one board covers many
 * BD employers. Descriptions/skills live on detail pages — enrich up to 10
 * new jobs per refresh. Deadlines (validThrough) come from the listing.
 */
async function fetchSkillJobs(board: Pick<Board, "id" | "name" | "url">): Promise<NormalizedListing[]> {
  const tech = parseSkillJobs(await fetchText(board.url)).filter((l) => isTechTitle(l.title));

  const knownEnriched = await knownEnrichedExternalIds(board.id, "description");

  let enriched = 0;
  for (const l of tech) {
    if (enriched >= 10) break;
    if (knownEnriched.has(l.externalId)) continue;
    try {
      const detail = parseSkillJobsDetail(await fetchText(l.url));
      if (!detail?.description) continue;
      l.description = detail.description;
      if (l.tags.length === 0 && detail.skills.length > 0) l.tags = detail.skills;
      enriched++;
    } catch {
      // detail fetch failed — try again next refresh
    }
  }
  if (enriched > 0) {
    await persistEnrichment(
      board.id,
      tech
        .filter((l) => l.description)
        .map((l) =>
          toPatch(l, {
            tags: JSON.stringify(l.tags),
            postedAt: l.postedAt,
            deadline: l.deadline ?? null,
          }),
        ),
    );
    console.log(`[jobradar] skill.jobs: enriched ${enriched} descriptions via detail pages`);
  }

  return tech;
}

/**
 * nextjobz.com.bd renders client-side, but exposes two usable surfaces:
 *  1. sitemap-job-details.xml — every job URL (with IJOB code)
 *  2. each detail page embeds the structured job object in its RSC data
 * We fetch sitemap → filter tech slugs → skip known codes → pull detail
 * pages for up to 60 NEW jobs per refresh (full coverage over time).
 */
async function fetchNextJobz(
  board: Pick<Board, "id" | "name" | "url">,
): Promise<NormalizedListing[]> {
  const xml = await fetchText("https://nextjobz.com.bd/sitemap-job-details.xml");
  const techUrls = filterTechUrls(parseNextJobzSitemap(xml));

  const existing = new Set(
    (
      await q<{ external_id: string }>(
        "select external_id from listings where board_id = $1",
        [board.id],
      )
    ).map((r) => r.external_id),
  );

  const targets = techUrls
    .filter((u) => {
      const code = u.match(/IJOB\d+/)?.[0];
      return !code || !existing.has(code);
    })
    .slice(0, 60);

  if (targets.length === 0) return [];

  const listings: NormalizedListing[] = [];
  for (let i = 0; i < targets.length; i += 10) {
    const results = await Promise.all(
      targets.slice(i, i + 10).map(async (u) => {
        try {
          return parseNextJobzDetail(await fetchText(u), u);
        } catch {
          return null;
        }
      }),
    );
    for (const l of results) if (l) listings.push(l);
  }
  return listings;
}

async function fetchApiListings(board: Pick<Board, "id" | "name" | "type" | "url">): Promise<NormalizedListing[]> {
  if (board.name === "Arbeitnow") return fetchArbeitnow();
  if (board.name === "BDJobs IT") return fetchBdjobs(board);
  if (board.name === "JapanDev") return fetchJapanDev(board);
  if (board.name === "Reed (UK)") return fetchReed(board);

  // URL-pattern dispatch for platforms hosting many companies
  const host = new URL(board.url).host;
  let payload: unknown;
  if (host.endsWith("smartrecruiters.com")) {
    payload = await fetchJson(board.url);
    return normalizeSmartRecruiters(payload);
  }
  if (host.endsWith("tekarsh.com")) {
    payload = await fetchJson(board.url);
    return normalizeTekarsh(payload);
  }

  const normalizer = pickNormalizer(board.name);
  if (!normalizer) {
    // Unknown API board — best effort: expect a JSON array of job objects.
    const payload = await fetchJson(board.url);
    const arr = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { jobs?: unknown[] })?.jobs)
        ? (payload as { jobs: unknown[] }).jobs
        : Array.isArray((payload as { data?: unknown[] })?.data)
          ? (payload as { data: unknown[] }).data
          : [];
    return arr.map((raw) => genericNormalize(raw));
  }

  return normalizer(await fetchJson(board.url));
}

/**
 * Arbeitnow paginates (~175 per page) — pull the first few pages so we see
 * beyond just the newest batch. Old listings expire via the 45-day rule.
 */
async function fetchArbeitnow(): Promise<NormalizedListing[]> {
  const all: NormalizedListing[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 3; page++) {
    const payload = await fetchJson(
      `https://www.arbeitnow.com/api/job-board-api${page > 1 ? `?page=${page}` : ""}`,
    );
    let fresh = 0;
    for (const l of normalizeArbeitnow(payload)) {
      if (!seen.has(l.externalId)) {
        seen.add(l.externalId);
        all.push(l);
        fresh++;
      }
    }
    if (fresh === 0) break; // ran past the end
  }
  return all;
}

/**
 * JapanDev web API — returns only the latest ~20 listings, no pagination.
 * Plenty for a refresh-cadence radar; the list payload has no description,
 * so new jobs are enriched from their detail endpoints (plain JSON — also
 * the only source of the explicit sponsors_visas flag). Enrichment is
 * bounded and skips jobs already processed on earlier refreshes.
 */
async function fetchJapanDev(board: Pick<Board, "id" | "name" | "url">): Promise<NormalizedListing[]> {
  const base = (() => {
    try {
      const u = new URL(board.url);
      return `${u.origin}${u.pathname}`;
    } catch {
      return "https://api.japan-dev.com/api/v1/jobs";
    }
  })();

  const all = normalizeJapanDev(await fetchJson(base));

  // ── enrich descriptions + visa flags via detail endpoints ────────────────
  const knownEnriched = await knownEnrichedExternalIds(board.id, "skills");
  let enriched = 0;
  for (const l of all) {
    if (l.description.length >= 80 && l.visaSponsorship) continue;
    if (enriched >= 30) break;
    if (knownEnriched.has(l.externalId)) continue;
    try {
      const detail = parseJapanDevDetail(await fetchJson(`${base}/${l.externalId}`));
      if (detail.description.length > l.description.length) l.description = detail.description;
      if (detail.sponsorsVisas !== null) l.visaSponsorship = detail.sponsorsVisas;
      else if (detail.description) l.visaSponsorship ||= detectVisaSponsorship(detail.description, l.title);
      enriched++;
    } catch {
      // detail fetch failed — keep list-API fields as-is
    }
  }
  // persist enriched text/skills/visa onto existing rows immediately (the
  // upsert in refresh.ts never overwrites existing rows)
  if (enriched > 0) {
    await persistEnrichment(
      board.id,
      all
        .filter((l) => l.description.length >= 80)
        .map((l) => toPatch(l, { visaSponsorship: l.visaSponsorship ? 1 : 0 })),
    );
    console.log(`[jobradar] japandev: enriched ${enriched} listings via detail API`);
  }

  return all;
}

/**
 * BDJobs IT category via their public search API (discovered by rendering
 * the search page once and capturing the XHR). 279 jobs over 6 pages.
 */
async function fetchBdjobs(
  board: Pick<Board, "id" | "name" | "url">,
): Promise<NormalizedListing[]> {
  const base =
    "https://api.bdjobs.com/Jobs/api/JobSearch/GetJobSearch?Icat=&industry=&category=8&org=&jobNature=&Fcat=&location=&Qot=&jobType=&jobLevel=&postedWithin=&deadline=&keyword=&qAge=&Salary=&experience=&gender=&MExp=&genderB=&MPostings=&MCat=&version=&rpp=50&Newspaper=&armyp=&QDisablePerson=&pwd=&workplace=&facilitiesForPWD=&SaveFilterList=&UserFilterName=&HUserFilterName=&earlyJobAccess=&isPro=0&ToggleJobs=true&isFresher=false";
  const all: NormalizedListing[] = [];
  const seen = new Set<string>();
  for (let pg = 1; pg <= 6; pg++) {
    const payload = await fetchJson(`${base}&pg=${pg}`);
    let fresh = 0;
    for (const l of normalizeBdjobs(payload)) {
      if (!seen.has(l.externalId)) {
        seen.add(l.externalId);
        all.push(l);
        fresh++;
      }
    }
    if (fresh === 0) break;
  }

  // ── enrich thin descriptions via detail pages ─────────────────────────
  // The list API returns only a short teaser (often empty); the full JD
  // renders on jobdetails.asp (Angular). Enrich up to 50 rows per refresh —
  // empties and thin teasers first — replacing the stored text whenever the
  // detail page beats it by a margin; rows already carrying skills are
  // skipped so each refresh advances through the catalog.
  const { renderText } = await import("@/lib/adapters/browser");
  const skillsKnown = await knownEnrichedExternalIds(board.id, "skills");
  let enriched = 0;
  let firstFailure: string | undefined;
  const stopAt = enrichStopAt();
  for (const l of all) {
    if (enriched >= 50 || Date.now() >= stopAt) break;
    if (skillsKnown.has(l.externalId)) continue; // already enriched before
    try {
      const text = await renderText(l.url, 3000);
      const cleaned = text.replace(/\s+/g, " ").trim();
      if (cleaned.length > l.description.length + 40) {
        l.description = cleaned;
        enriched++;
      }
    } catch (e) {
      // detail page failed — keep list-API description
      firstFailure ??= e instanceof Error ? e.message : String(e);
    }
  }
  // persist enriched text/skills onto existing rows immediately
  if (firstFailure) {
    console.error(`[jobradar] bdjobs: enrichment failing (${firstFailure})`);
  }
  if (enriched > 0) {
    await persistEnrichment(
      board.id,
      all
        .filter((l) => l.description.length >= 80)
        .map((l) => toPatch(l)),
      { onlyWhenUnenriched: true },
    );
    console.log(`[jobradar] bdjobs: enriched ${enriched} descriptions via detail pages`);
  }

  return all;
}

/**
 * Reed UK jobseeker API — free key required (reed.co.uk/developers/Jobseeker),
 * sent as the Basic-auth username with an empty password. Search results carry
 * no description, so new jobs are enriched from /jobs/{id} (up to 30 per
 * refresh, JapanDev-style: bounded, skipping rows already enriched).
 */
async function fetchReed(board: Pick<Board, "id" | "name" | "url">): Promise<NormalizedListing[]> {
  const apiKey = process.env.REED_API_KEY;
  if (!apiKey) {
    throw new Error("REED_API_KEY not set — create a free key at reed.co.uk/developers/Jobseeker");
  }
  const auth = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;

  // keep the seeded query, force a usable page size, walk up to two offset pages
  const searchUrl = new URL(board.url);
  searchUrl.searchParams.set("resultsToTake", "100");
  const all: NormalizedListing[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < 200; offset += 100) {
    searchUrl.searchParams.set("resultsOffset", String(offset));
    const payload: unknown = JSON.parse(await fetchText(searchUrl.toString(), { Authorization: auth }));
    let fresh = 0;
    for (const l of normalizeReed(payload)) {
      if (!seen.has(l.externalId)) {
        seen.add(l.externalId);
        all.push(l);
        fresh++;
      }
    }
    if (fresh === 0) break; // ran past the end
  }

  // ── enrich descriptions via the job-details endpoint ─────────────────────
  const knownEnriched = await knownEnrichedExternalIds(board.id, "description");
  let enriched = 0;
  for (const l of all) {
    if (l.description) continue;
    if (enriched >= 30) break;
    if (knownEnriched.has(l.externalId)) continue;
    try {
      const detail: unknown = JSON.parse(
        await fetchText(`https://www.reed.co.uk/api/1.0/jobs/${l.externalId}`, { Authorization: auth }),
      );
      const description = parseReedDetail(detail);
      if (!description) continue;
      l.description = description;
      l.visaSponsorship ||= detectVisaSponsorship(description, l.title);
      enriched++;
    } catch {
      // detail fetch failed — try again next refresh
    }
  }
  if (enriched > 0) {
    await persistEnrichment(
      board.id,
      all
        .filter((l) => l.description)
        .map((l) => toPatch(l, { visaSponsorship: l.visaSponsorship ? 1 : 0 })),
    );
    console.log(`[jobradar] reed: enriched ${enriched} descriptions via detail API`);
  }

  return all;
}

/**
 * arc.dev embeds its listings (vetted + external partner jobs, 30 each) in the
 * page's __NEXT_DATA__. Vetted jobs lack company/description — enrich up to 20
 * new jobs per refresh from the detail page payload, which also carries the
 * explicit visaOrRelocationRequired flag.
 */
async function fetchArc(board: Pick<Board, "id" | "name" | "url">): Promise<NormalizedListing[]> {
  const listings = parseArcJobs(await fetchText(board.url));

  const knownEnriched = await knownEnrichedExternalIds(board.id, "description");

  let enriched = 0;
  for (const l of listings) {
    if (l.description) continue;
    if (enriched >= 20) break;
    if (knownEnriched.has(l.externalId)) continue;
    try {
      const detail = parseArcDetail(await fetchText(l.url));
      if (!detail) continue;
      if (detail.description) l.description = detail.description;
      if (detail.visaSponsorship !== null) l.visaSponsorship = detail.visaSponsorship;
      else if (detail.description) l.visaSponsorship ||= detectVisaSponsorship(detail.description, l.title);
      if (!l.company && detail.company) l.company = detail.company;
      enriched++;
    } catch {
      // detail fetch failed — try again next refresh
    }
  }
  if (enriched > 0) {
    await persistEnrichment(
      board.id,
      listings
        .filter((l) => l.description)
        .map((l) =>
          toPatch(l, {
            visaSponsorship: l.visaSponsorship ? 1 : 0,
            company: l.company,
          }),
        ),
    );
    console.log(`[jobradar] arc.dev: enriched ${enriched} listings via detail pages`);
  }

  return listings;
}

/**
 * relocate.me renders plain-HTML job cards, newest first (~20 per page).
 * Fetch the first two pages; page 2 may legitimately run out of jobs, so its
 * failure is non-fatal. Enrich up to 10 new jobs per refresh from the detail
 * page's JSON-LD JobPosting (description + posted date) — relocation-native
 * board, so JDs frequently trip detectVisaSponsorship.
 */
async function fetchRelocateMe(board: Pick<Board, "id" | "name" | "url">): Promise<NormalizedListing[]> {
  const seen = new Map<string, NormalizedListing>();
  for (const l of parseRelocateMe(await fetchText(board.url))) seen.set(l.externalId, l);
  try {
    for (const l of parseRelocateMe(await fetchText(`${board.url}?page=2`))) {
      if (!seen.has(l.externalId)) seen.set(l.externalId, l);
    }
  } catch {
    // fewer than one full page of jobs — fine
  }
  const listings = [...seen.values()];

  const knownEnriched = await knownEnrichedExternalIds(board.id, "description");

  let enriched = 0;
  for (const l of listings) {
    if (l.description) continue;
    if (enriched >= 10) break;
    if (knownEnriched.has(l.externalId)) continue;
    try {
      const detail = parseRelocateMeDetail(await fetchText(l.url));
      if (!detail) continue;
      l.description = detail.description;
      if (detail.postedAt && !l.postedAt) l.postedAt = detail.postedAt;
      l.visaSponsorship ||= detectVisaSponsorship(detail.description, l.title);
      enriched++;
    } catch {
      // detail fetch failed — try again next refresh
    }
  }
  if (enriched > 0) {
    await persistEnrichment(
      board.id,
      listings
        .filter((l) => l.description)
        .map((l) =>
          toPatch(l, { visaSponsorship: l.visaSponsorship ? 1 : 0, postedAt: l.postedAt }),
        ),
    );
    console.log(`[jobradar] relocate.me: enriched ${enriched} descriptions via detail pages`);
  }

  return listings;
}

interface GenericJob {
  id?: unknown;
  guid?: unknown;
  slug?: unknown;
  title?: unknown;
  position?: unknown;
  company?: unknown;
  company_name?: unknown;
  companyName?: unknown;
  location?: unknown;
  url?: unknown;
  link?: unknown;
  applicationLink?: unknown;
  description?: unknown;
  date?: unknown;
  postedAt?: unknown;
  created_at?: unknown;
  publication_date?: unknown;
  tags?: unknown;
  remote?: unknown;
}

function genericNormalize(raw: unknown): NormalizedListing {
  const j = (raw ?? {}) as GenericJob;
  const url = String(j.url ?? j.link ?? j.applicationLink ?? "");
  const description = String(j.description ?? "");
  return {
    externalId: String(j.id ?? j.guid ?? j.slug ?? idFromUrl(url || String(j.title ?? ""))),
    title: String(j.title ?? j.position ?? "").trim(),
    company: String(j.company ?? j.company_name ?? j.companyName ?? "").trim(),
    location: String(j.location ?? "").trim(),
    isRemote: j.remote === true || /remote/i.test(String(j.location ?? "")),
    visaSponsorship: detectVisaSponsorship(description, String(j.title ?? "")),
    tags: Array.isArray(j.tags) ? j.tags.map(String) : [],
    url,
    postedAt:
      ((): string | null => {
        const v = j.date ?? j.postedAt ?? j.created_at ?? j.publication_date;
        if (v == null) return null;
        const d = new Date(typeof v === "number" ? (v > 1e12 ? v : v * 1000) : String(v));
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
      })(),
    description: description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
  };
}
