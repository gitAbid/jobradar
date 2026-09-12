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
  // tenants with zero openings render an explicit empty state — a valid
  // result, not a structural failure
  if (/no open job positions/i.test(html)) return [];

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

// ── easy.jobs SPA JSON API ─────────────────────────────────────────────────
// Tenant career pages are now a client-rendered SPA (a boot-spinner shell —
// no job anchors in the SSR HTML). The job data comes from the same JSON API
// the site itself calls: GET {origin}/api/career/home →
// { status, data: { jobs: [...], categories: [...] } }, with the full JD as
// HTML (requirements/responsibilities/benefits) inline per job, so no
// detail-page enrichment is needed. Tenants with zero openings return an
// empty jobs array.

interface EasyJobsApiJob {
  slug?: unknown;
  title?: unknown;
  expire_at?: unknown;
  published_at?: unknown;
  created_at?: unknown;
  requirements?: unknown;
  responsibilies?: unknown; // sic — the field name on easy.jobs' API
  benefits?: unknown;
  category?: unknown;
}

export function parseEasyJobsApi(payload: unknown, origin: string): NormalizedListing[] {
  const data = (payload as { data?: unknown } | null)?.data as
    | { jobs?: unknown }
    | undefined;
  const jobs = Array.isArray(data?.jobs) ? (data!.jobs as EasyJobsApiJob[]) : [];
  const listings: NormalizedListing[] = [];
  for (const j of jobs) {
    const slug = typeof j.slug === "string" ? j.slug : "";
    const title = typeof j.title === "string" ? j.title.trim() : "";
    if (!slug || !title) continue;
    const category = (j.category as { name?: unknown } | null)?.name;
    const description = [j.requirements, j.responsibilies, j.benefits]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .join(" ");
    const postedRaw = typeof j.published_at === "string" && j.published_at
      ? j.published_at
      : typeof j.created_at === "string" ? j.created_at : null;
    const posted = postedRaw ? new Date(postedRaw) : null;
    listings.push({
      externalId: slug,
      title,
      company: "", // filled from board name by the fetch layer
      location: "Dhaka, Bangladesh",
      isRemote: /remote/i.test(title),
      visaSponsorship: false,
      tags: typeof category === "string" && category ? [category] : [],
      url: `${origin}/${slug}`,
      postedAt: posted && !Number.isNaN(posted.getTime()) ? posted.toISOString() : null,
      deadline: typeof j.expire_at === "string" && j.expire_at ? j.expire_at : null,
      description: decodeEntities(
        description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      ),
    });
  }
  return listings;
}

// ── easy.jobs detail pages ─────────────────────────────────────────────────
// https://{tenant}.easy.jobs/{slug} is server-rendered: the full JD lives in
// a `<section class="content-card …">` block headed by `<h1>Description</h1>`,
// and a schema.org JobPosting JSON-LD carries datePosted.

export interface EasyJobsDetail {
  description: string;
  postedAt: string | null;
}

export function parseEasyJobsDetail(html: string): EasyJobsDetail | null {
  const h1 = /<h1[^>]*>\s*Description\s*<\/h1>/i.exec(html);
  if (!h1) return null;
  const start = h1.index + h1[0].length;
  const end = html.toLowerCase().indexOf("</section>", start);
  if (end === -1) return null;

  // block-level closers become line breaks; inline tags vanish; entities decode
  const rawLines = html
    .slice(start, end)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div|ul|ol|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n");
  const description = rawLines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map(decodeEntities)
    .join("\n");

  let postedAt: string | null = null;
  for (const m of html.matchAll(
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const data = JSON.parse(m[1]) as Record<string, unknown>;
      if (data["@type"] === "JobPosting" && typeof data.datePosted === "string") {
        const d = new Date(data.datePosted);
        postedAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
      }
    } catch {
      // malformed JSON-LD — ignore
    }
  }

  if (!description) return null;
  return { description, postedAt };
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

function toIsoOrNull(input: string | null | undefined): string | null {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── riseuplabs.com/jobs (SSR WordPress career page) ────────────────────────
// The listing page renders one `<div class="single-job">` block per opening:
//   <span class="h3 job-title"><a href="https://riseuplabs.com/jobs/{slug}/">TITLE</a></span>
//   <span class="type">Job Type: Full time</span>          (optional)
//   <span class="vacancy">Vacancies: 1</span>              (optional)
//   <span class="deadline">Deadline: September 18, 2026 (22 days left)</span> (optional)
// Detail pages carry the full JD inside `<div class="fw-page-builder-content">`.

export function parseRiseupLabs(html: string): NormalizedListing[] {
  const seen = new Map<string, NormalizedListing>();
  for (const block of html.split(/<div class="single-job">/i).slice(1)) {
    const link = /<a href="(https:\/\/riseuplabs\.com\/jobs\/([^/""]+)\/?)">([\s\S]*?)<\/a>/i.exec(
      block,
    );
    if (!link) continue;
    const url = link[1];
    const slug = link[2];
    const title = decodeEntities(link[3].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
    if (!title || title.length < 4 || seen.has(slug)) continue;

    const clean = (span: string | undefined) =>
      span
        ?.replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const type = clean(/<span class="type">([\s\S]*?)<\/span>/i.exec(block)?.[1])
      ?.replace(/^Job Type:\s*/i, "");
    const vacancy = clean(/<span class="vacancy">([\s\S]*?)<\/span>/i.exec(block)?.[1])
      ?.replace(/^Vacancies:\s*/i, "");
    const deadlineText = clean(/<span class="deadline">([\s\S]*?)<\/span>/i.exec(block)?.[1]);
    const deadline = toIsoOrNull(
      /Deadline:\s*([A-Za-z]+ \d{1,2}, \d{4})/i.exec(deadlineText ?? "")?.[1] ?? "",
    );

    seen.set(slug, {
      externalId: slug,
      title,
      company: "", // filled from board name by the fetch layer
      location: "Dhaka, Bangladesh",
      isRemote: /remote/i.test(title),
      visaSponsorship: false,
      tags: [
        type,
        vacancy ? `${vacancy.replace(/^(\d+)$/, "$1 vacancy")}` : "",
      ].filter((t): t is string => Boolean(t)),
      url,
      postedAt: null,
      deadline,
      description: "",
    });
  }
  if (seen.size === 0) {
    throw new Error("no jobs found in riseuplabs listing — structure may have changed");
  }
  return [...seen.values()];
}

/** Full JD text from a riseuplabs.com detail page; null when absent. */
export function parseRiseupLabsDetail(html: string): string | null {
  const m = /<div class="fw-page-builder-content">([\s\S]*?)<\/section>/i.exec(html);
  if (!m) return null;
  const rawLines = m[1]
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div|ul|ol|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n");
  const description = rawLines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map(decodeEntities)
    .join("\n");
  return description || null;
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

/** Tech-role test for titles from general job portals. */
export function isTechTitle(title: string): boolean {
  return TECH_SLUG_RE.test(title);
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

// ── skill.jobs (general BD portal, schema.org data in RSC payload) ─────────
// The listing page embeds each job as a schema.org JobPosting object inside
// its Next.js flight data: title, datePosted, validThrough (application
// deadline), hiringOrganization.name and addressLocality. Detail pages carry
// a regular JSON-LD JobPosting with the full HTML description. The portal is
// general-purpose, so callers filter to tech titles (isTechTitle).

export function parseSkillJobs(html: string): NormalizedListing[] {
  const chunks = flightChunks(html);
  const segments = chunks.split('\\"@type\\":\\"JobPosting\\"').slice(1);

  const seen = new Map<string, NormalizedListing>();
  for (const seg of segments) {
    const url = grabString(seg, "url") ?? grabString(seg, "@id");
    const title = grabString(seg, "title")?.trim();
    if (!title || title.length < 4 || !url) continue;
    const externalId = url.split("/jobs/")[1]?.replace(/\/$/, "") ?? url;
    if (!externalId || seen.has(externalId)) continue;

    // Skill.jobs is a Bangladesh-only portal: locality strings are BD cities
    // (occasionally missing the country name), so complete them for facets
    const locality = grabString(seg, "addressLocality") ?? "";
    const location = /bangladesh/i.test(locality) || !locality
      ? locality || "Bangladesh"
      : `${locality}, Bangladesh`;

    seen.set(externalId, {
      externalId,
      title,
      company: grabString(seg, "name") ?? "", // hiringOrganization.name
      location,
      isRemote: /remote|work from home/i.test(title),
      visaSponsorship: false,
      tags: [],
      url,
      postedAt: toIsoOrNull(grabString(seg, "datePosted")),
      deadline: toIsoOrNull(grabString(seg, "validThrough")),
      description: "",
    });
  }
  if (seen.size === 0) {
    throw new Error("no jobs found in skill.jobs payload — structure may have changed");
  }
  return [...seen.values()];
}

/** Full JD from a skill.jobs detail page's JSON-LD JobPosting; null when absent. */
export interface SkillJobsDetail {
  description: string;
  skills: string[];
}

export function parseSkillJobsDetail(html: string): SkillJobsDetail | null {
  for (const m of html.matchAll(
    /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi,
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
    const description = stripHtml(String(d.description ?? "")).trim();
    const skills = Array.isArray(d.skills)
      ? d.skills.map(String).slice(0, 12)
      : typeof d.skills === "string" && d.skills
        ? [d.skills]
        : [];
    if (!description) return null;
    return { description, skills };
  }
  return null;
}

// ── arc.dev (Next.js __NEXT_DATA__ payload) ────────────────────────────────
// https://arc.dev/remote-jobs embeds all listings in __NEXT_DATA__:
//   pageProps.arcJobs      — vetted Arc jobs (no company name yet; detail
//                            enrichment fills description/visa/company)
//   pageProps.externalJobs — jobs aggregated from partner boards (company set)
// Detail URLs: /remote-jobs/details/{urlString}-{randomKey}  (vetted)
//              /remote-jobs/j/{urlString}-{randomKey}        (external)

function parseNextData(html: string): Record<string, unknown> | null {
  const i = html.indexOf("__NEXT_DATA__");
  if (i === -1) return null;
  const start = html.indexOf(">", i) + 1;
  const end = html.indexOf("</script>", start);
  if (end === -1) return null;
  try {
    return JSON.parse(html.slice(start, end)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function arcPageProps(html: string): Record<string, unknown> | null {
  const data = parseNextData(html);
  const pageProps = (data?.props as { pageProps?: Record<string, unknown> } | undefined)?.pageProps;
  return pageProps ?? null;
}

interface ArcListJob {
  randomKey?: string;
  title?: string;
  requiredCountries?: string[];
  urlString?: string;
  postedAt?: number | null;
  minAnnualSalary?: number | null;
  maxAnnualSalary?: number | null;
  minHourlyRate?: number | null;
  maxHourlyRate?: number | null;
  company?: { name?: string } | null;
  categories?: Array<{ name?: string }> | null;
}

function arcSalaryTag(j: ArcListJob): string | null {
  if (j.minHourlyRate || j.maxHourlyRate) {
    const fmt = (v?: number | null) => (v ? `$${v}` : "?");
    return `${fmt(j.minHourlyRate)} ~ ${fmt(j.maxHourlyRate)}/hr`;
  }
  if (j.minAnnualSalary || j.maxAnnualSalary) {
    const fmt = (v?: number | null) => (v ? `$${Math.round(v / 1000)}k` : "?");
    return `${fmt(j.minAnnualSalary)} ~ ${fmt(j.maxAnnualSalary)}`;
  }
  return null;
}

function arcPostedAt(v: number | null | undefined): string | null {
  if (v == null) return null;
  const d = new Date(v < 1e12 ? v * 1000 : v); // unix seconds or ms
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeArcJob(j: ArcListJob, pathPrefix: string): NormalizedListing | null {
  const key = String(j.randomKey ?? "");
  if (!key || !j.urlString || !j.title) return null;
  const salary = arcSalaryTag(j);
  return {
    externalId: key,
    title: String(j.title).trim(),
    company: String(j.company?.name ?? "").trim(),
    // an empty requiredCountries array is Arc's "worldwide" marker
    location: (j.requiredCountries ?? []).length > 0 ? j.requiredCountries!.join(", ") : "Anywhere",
    isRemote: true,
    visaSponsorship: false, // detail enrichment reads visaOrRelocationRequired
    tags: [
      ...(j.categories ?? []).map((c) => String(c.name ?? "")).filter(Boolean),
      ...(salary ? [salary] : []),
    ].slice(0, 12),
    url: `https://arc.dev/remote-jobs/${pathPrefix}${j.urlString}-${key}`,
    postedAt: arcPostedAt(j.postedAt),
    description: "",
  };
}

export function parseArcJobs(html: string): NormalizedListing[] {
  const pageProps = arcPageProps(html);
  if (!pageProps || !("arcJobs" in pageProps)) {
    throw new Error("no __NEXT_DATA__ payload in arc.dev listing — structure may have changed");
  }
  const arcJobs = Array.isArray(pageProps.arcJobs) ? (pageProps.arcJobs as ArcListJob[]) : [];
  const externalJobs = Array.isArray(pageProps.externalJobs)
    ? (pageProps.externalJobs as ArcListJob[])
    : [];

  const seen = new Map<string, NormalizedListing>();
  for (const j of arcJobs) {
    const l = normalizeArcJob(j, "details/");
    if (l && !seen.has(l.externalId)) seen.set(l.externalId, l);
  }
  for (const j of externalJobs) {
    const l = normalizeArcJob(j, "j/");
    if (l && !seen.has(l.externalId)) seen.set(l.externalId, l);
  }
  return [...seen.values()];
}

export interface ArcDetail {
  description: string;
  /** tri-state from visaOrRelocationRequired; null when the field is absent */
  visaSponsorship: boolean | null;
  /** hiring company name from pageProps.company (vetted jobs only) */
  company: string | null;
}

export function parseArcDetail(html: string): ArcDetail | null {
  const pageProps = arcPageProps(html);
  const job = pageProps?.job as Record<string, unknown> | undefined;
  if (!job) return null;
  const visa = job.visaOrRelocationRequired;
  const company = pageProps?.company as { name?: unknown } | undefined;
  return {
    description: stripHtml(String(job.description ?? "")),
    visaSponsorship: typeof visa === "boolean" ? visa : null,
    company: company && typeof company.name === "string" ? company.name : null,
  };
}

// ── relocate.me (server-rendered relocation board) ─────────────────────────
// https://relocate.me/international-jobs renders plain-HTML job cards:
//   <a href="/{country}/{city}/{company}/{slug}-{id}">
//     <div class="job__title">TITLE</div> <div class="job__company">COMPANY</div>
// Country/city/company come from the URL path. Detail pages embed a JSON-LD
// JobPosting with the full HTML description and datePosted.

const RELOCATE_JOB_RE =
  /<a[^>]+href="\/([a-z-]+)\/([a-z-]+)\/([a-z0-9-]+)\/([a-z0-9-]+?)-(\d{3,})"[^>]*>([\s\S]*?)<\/a>/gi;

function titleCaseSlug(segment: string): string {
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function parseRelocateMe(html: string): NormalizedListing[] {
  const seen = new Map<string, NormalizedListing>();
  let m: RegExpExecArray | null;
  while ((m = RELOCATE_JOB_RE.exec(html)) !== null) {
    const [, country, city, companySlug, slug, id, inner] = m;
    if (!id || seen.has(id)) continue;
    // "/remote/..." cards are site promos (e.g. the paid curated-list ad), not jobs
    if (country === "remote") continue;
    const titleBlock = /class="job__title"[^>]*>([\s\S]*?)<\/(h\d|div|span|p)/i.exec(inner ?? "");
    const title = titleBlock
      ? decodeEntities(titleBlock[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      : titleCaseSlug(slug);
    if (!title || title.length < 4) continue;
    seen.set(id, {
      externalId: id,
      title,
      company: titleCaseSlug(companySlug),
      location: `${titleCaseSlug(city)}, ${titleCaseSlug(country)}`,
      isRemote: /remote|anywhere/i.test(title),
      visaSponsorship: false, // detail enrichment detects visa/relocation wording
      tags: [],
      url: `https://relocate.me/${country}/${city}/${companySlug}/${slug}-${id}`,
      postedAt: null,
      description: "",
    });
  }
  if (seen.size === 0) {
    throw new Error("no job links found in relocate.me listing — structure may have changed");
  }
  return [...seen.values()];
}

export interface RelocateMeDetail {
  description: string;
  postedAt: string | null;
}

export function parseRelocateMeDetail(html: string): RelocateMeDetail | null {
  for (const m of html.matchAll(
    /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data: unknown;
    try {
      // relocate.me pretty-prints its JSON-LD with raw newlines INSIDE string
      // values (invalid strict JSON) — collapse whitespace before parsing
      data = JSON.parse(m[1].replace(/\s+/g, " "));
    } catch {
      continue;
    }
    if (typeof data !== "object" || data === null) continue;
    const d = data as Record<string, unknown>;
    if (d["@type"] !== "JobPosting") continue;
    const description = stripHtml(String(d.description ?? ""));
    if (!description) return null;
    return {
      description,
      postedAt: toIsoOrNull(typeof d.datePosted === "string" ? d.datePosted : null),
    };
  }
  return null;
}
