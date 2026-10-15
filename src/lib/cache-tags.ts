/**
 * Cache tags for the `'use cache'` listing reads (src/lib/job-query.ts) and
 * the writes that invalidate them. One place, so a typo can't silently stop
 * an invalidation from reaching its cache entries.
 */

/** Shared listings pool + boards/status: every refresh and board edit. */
export const LISTINGS_TAG = "listings";

/** One user's listing state (status, tags, follows, settings). */
export function userStateTag(userId: string | null | undefined): string {
  return `user-state:${userId ?? "anon"}`;
}
