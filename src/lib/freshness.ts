// ── Listing freshness model ────────────────────────────────────────────────
// Derives a scannable freshness tier from the posting age and, when the
// source board exposes one, the application deadline. Deadline states are
// more urgent than age states, so they take precedence; everything else is
// derived purely from postedAt. "recent"/"aging"/"unknown" are quiet tiers —
// the UI renders no badge or highlight for them so the average card stays calm.

export type FreshnessTier = "fresh" | "recent" | "aging" | "closing" | "expired" | "unknown";

export interface FreshnessInput {
  postedAt: string | null;
  deadline: string | null;
}

export interface FreshnessInfo {
  tier: FreshnessTier;
  /** short badge label; null for quiet tiers that render no badge */
  label: string | null;
}

const DAY_MS = 86_400_000;
/** posted within this window → "fresh" */
const FRESH_DAYS = 3;
/** posted within this window → "recent" (quiet) */
const RECENT_DAYS = 10;
/** deadline within this window → "closing soon" */
const CLOSING_DAYS = 3;

function parseOrNull(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

export function freshnessOf(listing: FreshnessInput, now: number = Date.now()): FreshnessInfo {
  const deadline = parseOrNull(listing.deadline);
  if (deadline !== null) {
    if (deadline <= now) return { tier: "expired", label: "Deadline passed" };
    const daysLeft = Math.ceil((deadline - now) / DAY_MS);
    if (daysLeft <= CLOSING_DAYS) {
      return { tier: "closing", label: daysLeft <= 1 ? "Closing soon" : `Closes in ${daysLeft}d` };
    }
  }

  const posted = parseOrNull(listing.postedAt);
  if (posted !== null) {
    const ageDays = (now - posted) / DAY_MS;
    if (ageDays <= FRESH_DAYS) return { tier: "fresh", label: "New" };
    if (ageDays <= RECENT_DAYS) return { tier: "recent", label: null };
    return { tier: "aging", label: null };
  }

  return { tier: "unknown", label: null };
}
