# Freshness Badge & Card Highlighting — Design

**Date:** 2026-08-29
**Status:** Implemented

## Goal

Give each job card a scannable freshness signal derived from when it was
posted and (when the source board exposes one) its application deadline —
expressly elegant and subtle: quiet cards stay untouched, no treatment may
reduce text readability.

## Freshness model (`src/lib/freshness.ts`)

Pure function `freshnessOf({ postedAt, deadline }, now?)` → `{ tier, label }`.
Deadline states outrank age states (they are more urgent):

| Tier      | Trigger                                  | Badge label        | Card treatment                          |
| --------- | ---------------------------------------- | ------------------ | --------------------------------------- |
| `expired` | deadline in the past                     | "Deadline passed"  | 3px muted slate left edge               |
| `closing` | deadline ≤ 3 days away                   | "Closing soon" (≤24h) / "Closes in Nd" | 3px amber left edge + faint amber tint + amber pill |
| `fresh`   | posted ≤ 3 days ago                      | "New"              | 3px emerald left edge + faint emerald tint + emerald pill |
| `recent`  | posted ≤ 10 days ago                     | — (quiet)          | none                                    |
| `aging`   | posted > 10 days ago                     | — (quiet)          | none                                    |
| `unknown` | no (parseable) dates                     | — (quiet)          | none                                   |

Subtlety comes from *sparsity*: only urgent/young tiers get any treatment,
and it is limited to a soft left edge (`border-l-[3px]`, ~70% alpha), a ~15%
background tint (`bg-*-50/40`), and a small pill matching the existing
Remote/Visa pill idiom (`text-[10px] font-bold uppercase`). Text colors are
unchanged everywhere, so contrast/readability is never affected. Hover keeps
the accent hue via `hover:border-l-*` (side-specific color wins over the
generic `hover:border-teal-200`).

## Deadline data plumbing

Only two boards expose deadlines in their APIs: **BDJobs** (`deadlineDB` /
`deadline`) and **Tekarsh** (`deadline`). Plumb-through follows the existing
pattern used for `skills` / `remote_scope` / `description`:

1. `NormalizedListing` gets optional `deadline?: string | null`; adapters
   map it via the existing `toIsoDate` (unparseable → `null`).
2. `listings` table gets a nullable `deadline TEXT` column: added to the
   fresh-DB `CREATE TABLE`, the `listings_fixed` repair table (with a
   source-column guard, since a pre-feature DB in the broken state lacks the
   column *before* the lightweight migrations run), and the
   `ALTER TABLE` migration block.
3. `upsertListings` inserts it; `rowToListing` maps it back
   (`Listing.deadline: string | null`). All pages use `SELECT l.*`, so they
   pick the column up automatically.

Note: upserts are `ON CONFLICT DO NOTHING`, so only *newly inserted* rows get
a deadline — consistent with how `posted_at` and every other field behaves.

## UI (`src/components/ListingCard.tsx`)

- Badge renders in the title pill row (first position), only when `label`
  is non-null: colored dot + label pill.
- Card `<article>` appends `CARD_ACCENT[tier]` classes.
- Tier→class maps (`CARD_ACCENT`, `BADGE_STYLE`, `BADGE_DOT`) are exhaustive
  `Record<FreshnessTier, string>` so adding a tier is a compiler error.
- Badge `title` tooltip shows the concrete deadline/posted date.

## Testing

- `tests/freshness.test.ts`: tier boundaries (3d/10d), closing labels
  ("Closes in 2d" vs "Closing soon"), precedence (expired > closing >
  age), missing/malformed dates.
- `tests/bdjobs.test.ts`: deadline mapping, `deadlineDB` preferred over the
  display deadline, unparseable → null.
- `tests/adapters.test.ts` (Tekarsh): deadline mapped to ISO.

## Verified

- 93/93 vitest tests pass; `tsc --noEmit` clean; touched files lint clean
  (one pre-existing lint error in the user's WIP `RefreshStatusBar.tsx`).
- Migration applied to a backup copy of the live DB (4,123 listings):
  clean ALTER, `SELECT l.*` + upsert verified, `integrity_check` ok.
- Browser-verified on the live dev server: NEW (emerald), CLOSES IN 3D
  (amber), DEADLINE PASSED (muted slate), and quiet cards render as before.
