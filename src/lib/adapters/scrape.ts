import type { NormalizedListing } from "@/lib/types";
import { detectVisaSponsorship, idFromUrl, stripHtml } from "@/lib/adapters/normalize";

/**
 * Scrapers for BD job sources that render server-side HTML.
 *
 * Currently supported:
 *  - easy.jobs tenant boards (https://{tenant}.easy.jobs/) — the hiring
 *    platform used by many Bangladeshi tech companies (Brain Station 23 etc.)
 *  - tokyodev.com — SSR listing page grouped by company (plain HTML fetch;
 *    Cloudflare only challenges their /api/* paths and detail pages)
 *
 * Sites that require JS/cookies (BDjobs, nextjobz, Airwork, atB Jobs,
 * Talvette) are NOT scrapable this way and are intentionally excluded.
 */

export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/**
 * Parse an easy.jobs tenant board page.
 * Job cards are anchors: <a href="https://{tenant}.easy.jobs/{slug}">…title…</a>
 */
export function parseEasyJobs(html: string, baseUrl: string): NormalizedListing[] {
  const origin = new URL(baseUrl).origin;
  const anchorRe = new RegExp(
    `<a[^>]+href="${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([a-z0-9-]+)"[^>]*>([\\s\\S]*?)</a>`,
    "gi",
  );

  const seen = new Map<string, NormalizedListing>();
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const slug = m[1];
    const inner = m[2];
    // prefer an explicit heading inside the anchor; fall back to all text
    const heading = inner.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    const title = decodeEntities(
      (heading ? heading[1] : inner)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (!title || title.length < 4 || seen.has(slug)) continue;

    seen.set(slug, {
      externalId: slug,
      title,
      company: "", // filled from board name by the fetch layer
      location: "Dhaka, Bangladesh",
      isRemote: /remote/i.test(title),
      visaSponsorship: false,
      tags: [],
      url: `${origin}/${slug}`,
      postedAt: null,
      description: "",
    });
  }
  if (seen.size === 0) {
    throw new Error("no job links found — page structure may have changed");
  }
  return [...seen.values()];
}

// ── tokyodev.com (SSR listing grouped by company) ──────────────────────────
// https://www.tokyodev.com/jobs renders ALL listings on one page. Each job:
//   <div class="text-lg font-bold mb-1"><a href="/companies/{c}/jobs/{slug}">TITLE</a></div>
//   <div class="flex gap-2 flex-wrap font-sm">
//     <a class="text-sm tag tag-*" href="/jobs/{tag-slug}">TAG TEXT</a>...
//   </div>
// Tag slugs carry the semantics: fully-remote/partially-remote/no-remote,
// apply-from-abroad, residents-only, no-japanese-required, salary-data (¥ range),
// plus free-form tech/category tags (backend, react, ...).

const TOKYODEV_JOB_RE =
  /<div class="text-lg font-bold mb-1">\s*<a[^>]*href="\/companies\/([a-z0-9-]+)\/jobs\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi;

const TOKYODEV_TAG_RE = /<a class="text-sm tag[^"]*" href="\/jobs\/([a-z0-9-]+)">([\s\S]*?)<\/a>/gi;

/** Map each `<li id="company_{slug}">` start offset to the company display name. */
function tokyoDevCompanySegments(html: string): Array<{ start: number; name: string }> {
  const segments: Array<{ start: number; name: string }> = [];
  for (const m of html.matchAll(/<li id="company_[a-z0-9-]+">/gi)) {
    const rest = html.slice(m.index ?? 0, (m.index ?? 0) + 2000);
    const name = /<h3[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i.exec(rest)?.[1];
    if (name) {
      segments.push({ start: m.index ?? 0, name: decodeEntities(name.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()) });
    }
  }
  return segments;
}

export function parseTokyoDev(html: string): NormalizedListing[] {
  const seen = new Map<string, NormalizedListing>();
  const companies = tokyoDevCompanySegments(html);
  const matches = [...html.matchAll(TOKYODEV_JOB_RE)];
  for (let i = 0; i < matches.length; i++) {
    const [, companySlug, jobSlug, rawTitle] = matches[i];
    const matchStart = matches[i].index ?? 0;
    const title = decodeEntities(rawTitle.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
    const externalId = `${companySlug}/${jobSlug}`;
    if (!title || title.length < 4 || seen.has(externalId)) continue;

    // tags live in the block between this job's title link and the next one
    const windowEnd = i + 1 < matches.length ? matches[i + 1].index ?? html.length : html.length;
    const block = html.slice(matchStart, windowEnd);
    const company = companies.findLast((c) => c.start <= matchStart)?.name ?? "";

    let isRemote = false;
    const tags: string[] = [];
    for (const tag of block.matchAll(TOKYODEV_TAG_RE)) {
      const slug = tag[1];
      const text = decodeEntities(tag[2].replace(/\s+/g, " ").trim());
      if (!text) continue;
      // remote-policy tags are redundant with the isRemote flag
      if (/^(fully|partially)-remote$|^no-remote$/.test(slug)) {
        isRemote = isRemote || slug !== "no-remote";
        continue;
      }
      tags.push(text);
    }

    seen.set(externalId, {
      externalId,
      title,
      company,
      location: "Japan",
      isRemote,
      visaSponsorship: tags.some((t) => /apply from abroad/i.test(t)),
      tags: tags.slice(0, 12),
      url: `https://www.tokyodev.com/companies/${companySlug}/jobs/${jobSlug}`,
      postedAt: null,
      description: "",
    });
  }
  if (seen.size === 0) {
    throw new Error("no jobs found in tokyodev listing — structure may have changed");
  }
  return [...seen.values()];
}

export interface TokyoDevDetail {
  description: string;
  postedAt: string | null;
  /** "Minato-ku, Tokyo" style city-level location, when present */
  location: string | null;
}

/**
 * TokyoDev detail pages embed a schema.org JobPosting as JSON-LD with the
 * full HTML description, posting date and office address.
 */
export function parseTokyoDevDetail(html: string): TokyoDevDetail | null {
  for (const m of html.matchAll(
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    if (typeof data !== "object" || data === null) continue;
    const d = data as Record<string, unknown>;
    if (d["@type"] !== "JobPosting") continue;
    const address = ((d.jobLocation as Record<string, unknown>)?.address ?? {}) as Record<
      string,
      unknown
    >;
    const loc = [address.addressLocality, address.addressRegion]
      .filter((v) => typeof v === "string")
      .join(", ");
    const posted = typeof d.datePosted === "string" ? toIsoOrNull(d.datePosted) : null;
    return {
      description: stripHtml(String(d.description ?? "")),
      postedAt: posted,
      location: loc || null,
    };
  }
  return null;
}

function toIsoOrNull(input: string): string | null {
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// keep idFromUrl referenced for future scrapers
void idFromUrl;

// ── nextjobz.com.bd (RSC flight payload) ───────────────────────────────────
// The site is a Next.js App Router SPA, but requesting /jobs with the `RSC: 1`
// header returns the server flight payload containing fully structured job
// objects — no headless browser needed.

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

function unescapeJsonString(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\\//g, "/");
}

const NEXTJOBZ_ITEM_RE =
  /"jobMasterId":(\d+),"jobTitle":"((?:[^"\\]|\\.)*)","jobCode":"([^"]+)","companyName":"((?:[^"\\]|\\.)*)","jobLocation":"((?:[^"\\]|\\.)*)","workType":"([^"]*)","employmentType":"([^"]*)"(?:,"jobSkills":"(\[[^\]]*\])")?(?:,"fromDate":"([^"]*)")?/g;

export function parseNextJobzRsc(flight: string, baseUrl: string): NormalizedListing[] {  const origin = new URL(baseUrl).origin;
  const seen = new Map<string, NormalizedListing>();
  let m: RegExpExecArray | null;
  while ((m = NEXTJOBZ_ITEM_RE.exec(flight)) !== null) {
    const [, , rawTitle, jobCode, rawCompany, rawLoc, workType, empType, skillsJson, fromDate] = m;
    const title = unescapeJsonString(rawTitle).trim();
    if (!title || seen.has(jobCode)) continue;
    const company = unescapeJsonString(rawCompany).trim();
    const loc = unescapeJsonString(rawLoc).trim();
    const skills = skillsJson
      ? (() => {
          try {
            // flight payload escapes quotes: "[\"Skill\"]" → strip backslashes
            const v = JSON.parse(skillsJson.replace(/\\(.)/g, "$1"));
            return Array.isArray(v) ? v.map(String).slice(0, 12) : [];
          } catch {
            return [];
          }
        })()
      : [];

    const slugParts = [slugify(title), loc ? slugify(loc) : "", jobCode].filter(Boolean);
    seen.set(jobCode, {
      externalId: jobCode,
      title,
      company,
      location: loc ? `${loc}, Bangladesh` : "Bangladesh",
      isRemote: /remote/i.test(`${workType} ${empType} ${title}`),
      visaSponsorship: false,
      tags: [...skills, ...(workType ? [workType] : []), ...(empType ? [empType] : [])],
      url: `${origin}/jobs/${slugParts.join("-")}`,
      postedAt: fromDate ?? null,
      description: "",
    });
  }
  if (seen.size === 0) {
    throw new Error("no jobs found in nextjobz payload — structure may have changed");
  }
  return [...seen.values()];
}

// ── nextjobz sitemap + detail-page pipeline (full IT-jobs coverage) ────────

/** Pull all job URLs out of nextjobz's sitemap-job-details.xml. */
export function parseNextJobzSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.includes("/jobs/"));
}

const TECH_SLUG_RE =
  /(developer|engineer|software|java|spring|python|php|laravel|react|angular|vue|node|dotnet|-net-|devops|qa-|tester|test-|android|ios|flutter|fullstack|full-stack|backend|back-end|frontend|front-end|programmer|shopify|wordpress|web-|database|architect|scrum|technical|kotlin|scala|ruby|sre|security|network|system-admin|ui-|ux-|ict|it-support|cloud|data)/i;

export function filterTechUrls(urls: string[]): string[] {
  return urls.filter((u) => TECH_SLUG_RE.test(u));
}

function flightChunks(html: string): string {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/g)]
    .map((m) => m[1])
    .join("");
}

/**
 * Decode a flight-payload string value: the capture keeps JSON escape
 * sequences intact, so wrapping it in quotes and JSON.parse resolves
 * \u003c, \" and \\ layers in one shot.
 */
function grabString(seg: string, field: string): string | null {
  // lazy value + mandatory (backslash-optional) closing quote: stops at the
  // first real field boundary while consuming escaped \" pairs inside values
  const re = new RegExp(
    `\\\\*"${field}\\\\*":\\\\*"((?:[^"\\\\]|\\\\.)*?)\\\\*"`,
  );
  const m = re.exec(seg);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1];
  }
}

/**
 * Parse one nextjobz job detail page. The main job's structured object lives
 * in the embedded RSC flight data before the "relevantJobs" section.
 */
export function parseNextJobzDetail(
  html: string,
  detailUrl: string,
): NormalizedListing | null {
  const code = detailUrl.match(/IJOB\d+/)?.[0];
  if (!code) return null;

  const joined = flightChunks(html);
  const cutAt = joined.indexOf("relevantJobs");
  const seg = cutAt > -1 ? joined.slice(0, cutAt) : joined;
  if (!seg.includes(code)) return null; // main job not present

  const title = grabString(seg, "strJobTitle");
  if (!title) return null;
  const company = grabString(seg, "strCompanyName") ?? "";
  const jobLocation = grabString(seg, "strJobLocation") ?? "";
  const country = grabString(seg, "strCountryName") || "Bangladesh";
  const workType = grabString(seg, "strWorkType") ?? "";
  const employmentType = grabString(seg, "strEmploymentType");
  const salary = grabString(seg, "strSalaryDescription");
  const years = grabString(seg, "strYearsOfExperience");
  const description = grabString(seg, "strJobDescription")
    ?.replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const skillsRaw = grabString(seg, "strJobSkills");
  const skills = skillsRaw
    ? (() => {
        try {
          const v = JSON.parse(skillsRaw.replace(/\\"/g, '"'));
          return Array.isArray(v) ? v.map(String).slice(0, 12) : [];
        } catch {
          return [];
        }
      })()
    : [];

  const loc = [jobLocation, country].filter(Boolean).join(", ");
  return {
    externalId: code,
    title,
    company,
    location: loc || "Bangladesh",
    isRemote: /remote/i.test(`${workType} ${title}`),
    visaSponsorship: detectVisaSponsorship(description, title),
    tags: [
      ...skills,
      ...(workType ? [workType] : []),
      ...(employmentType ? [employmentType] : []),
      ...(salary ? [salary] : []),
      ...(years ? [years] : []),
    ].slice(0, 12),
    url: detailUrl,
    postedAt: null,
    description: description ?? "",
  };
}
