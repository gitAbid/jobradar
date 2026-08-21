import type { FilterableListing } from "@/lib/types";

/**
 * Filter engine — a listing matches if ANY keyword (global ∪ board-specific)
 * hits its title, company, location, tags or description snippet.
 * Matching is case-insensitive; keywords are matched on word boundaries
 * so "java" does not match "javascript" ("spring boot" stays a phrase).
 */
const KEYWORD_CACHE = new Map<string, RegExp>();

function keywordRegex(keyword: string): RegExp {
  let re = KEYWORD_CACHE.get(keyword);
  if (!re) {
    const esc = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pre = /^\w/.test(keyword) ? "\\b" : "";
    const post = /\w$/.test(keyword) ? "\\b" : "";
    re = new RegExp(`${pre}${esc}${post}`, "i");
    KEYWORD_CACHE.set(keyword, re);
  }
  return re;
}

export function matchesKeywords(
  listing: Pick<FilterableListing, "title" | "company" | "location" | "tags"> & {
    boardFilterKeywords: string[];
  },
  globalKeywords: string[],
): boolean {
  const keywords = [...new Set([...globalKeywords, ...listing.boardFilterKeywords])]
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  if (keywords.length === 0) return true; // no filters → everything matches

  const haystack = buildHaystack(listing);
  return keywords.some((k) => keywordRegex(k).test(haystack));
}

/** Keywords (from the active set) actually present in this listing — for UI highlighting. */
export function matchedKeywords(
  listing: Pick<FilterableListing, "title" | "company" | "location" | "tags"> & {
    boardFilterKeywords: string[];
  },
  globalKeywords: string[],
): string[] {
  const keywords = [...new Set([...globalKeywords, ...listing.boardFilterKeywords])]
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  const haystack = buildHaystack(listing);
  return keywords.filter((k) => keywordRegex(k).test(haystack));
}

/**
 * Keyword matching runs against structured fields only (title, company,
 * location, tags) — NOT the description blob. Role words like "lead" or
 * "senior" appear in nearly every description and would drown the signal.
 */
function buildHaystack(
  listing: Pick<FilterableListing, "title" | "company" | "location" | "tags">,
): string {
  return [listing.title, listing.company, listing.location, listing.tags.join(" ")]
    .join(" ")
    .toLowerCase();
}

/**
 * Build the stored search_text blob: title + company + location + tags +
 * first 2000 chars of description, lowercased.
 */
export function buildSearchText(input: {
  title: string;
  company: string;
  location: string;
  tags: string[];
  description: string;
}): string {
  const stripHtml = input.description
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [
    input.title,
    input.company,
    input.location,
    input.tags.join(" "),
    stripHtml.slice(0, 2000),
  ]
    .join(" ")
    .toLowerCase();
}
