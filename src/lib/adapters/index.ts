import Parser from "rss-parser";
import type { Board, NormalizedListing } from "@/lib/types";
import {
  normalizeAirwork,
  normalizeArbeitnow,
  normalizeGreenhouse,
  normalizeHimalayas,
  normalizeRemoteOk,
  normalizeRemotive,
  normalizeTalvette,
  normalizeWorkingNomads,
  detectVisaSponsorship,
  detectRemoteScope,
  idFromUrl,
} from "@/lib/adapters/normalize";
import { parseEasyJobs, parseNextJobzDetail, parseNextJobzRsc, parseNextJobzSitemap, filterTechUrls } from "@/lib/adapters/scrape";
import { getDb } from "@/db";

const TIMEOUT_MS = 15_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) JobRadar/1.0 (+https://localhost)";

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
    return {
      externalId: String(item.guid ?? item.link ?? idFromUrl(title)),
      title,
      company,
      location: "Remote",
      isRemote: true,
      visaSponsorship: detectVisaSponsorship(description, title),
      tags: Array.isArray(item.categories) ? item.categories.map(String) : [],
      url: String(item.link ?? ""),
      postedAt: item.isoDate ?? item.pubDate ?? null,
      description: description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
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

/** HTML scrapers + reverse-engineered JSON APIs for BD sources. */
async function fetchScraped(
  board: Pick<Board, "id" | "name" | "url">,
): Promise<NormalizedListing[]> {  const host = new URL(board.url).host;
  let listings: NormalizedListing[];
  if (host.endsWith("easy.jobs")) {
    listings = parseEasyJobs(await fetchText(board.url), board.url);
  } else if (host.endsWith("nextjobz.com.bd")) {
    listings = await fetchNextJobz(board);
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
      getDb()
        .prepare("SELECT external_id FROM listings WHERE board_id = ?")
        .all(board.id) as { external_id: string }[]
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

async function fetchApiListings(board: Pick<Board, "name" | "type" | "url">): Promise<NormalizedListing[]> {
  if (board.name === "Arbeitnow") return fetchArbeitnow();

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
