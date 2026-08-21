import type { NormalizedListing } from "@/lib/types";
import { detectVisaSponsorship, idFromUrl } from "@/lib/adapters/normalize";

/**
 * Scrapers for BD job sources that render server-side HTML.
 *
 * Currently supported:
 *  - easy.jobs tenant boards (https://{tenant}.easy.jobs/) — the hiring
 *    platform used by many Bangladeshi tech companies (Brain Station 23 etc.)
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

export function parseNextJobzRsc(flight: string, baseUrl: string): NormalizedListing[] {
  const origin = new URL(baseUrl).origin;
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
