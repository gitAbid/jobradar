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
