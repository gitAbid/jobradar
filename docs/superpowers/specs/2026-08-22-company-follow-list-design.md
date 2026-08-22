# Company Follow List + Applied Navigation Fix

Date: 2026-08-22
Status: Approved

## Problem

1. Users want to follow specific companies and see their current openings collected in one place.
2. Navigating to `/applied` feels broken: every page calls `await connection()`, making routes dynamic. In Next.js 16, `<Link>` skips prefetching dynamic routes unless the route segment has a `loading.tsx` boundary. This app has none, so clicking "Applied" blocks until the full server render completes with no visual feedback.

## Decisions

- Followed openings live on a **dedicated `/following` page** (nav item "Following"), not a dashboard filter.
- **Follow/unfollow buttons live on every job card** (dashboard `ListingCard` and pipeline `PipelineCard`).
- Storage: dedicated SQLite table (chosen over normalizing companies into entities, and over JSON in `app_settings`).

## Data model

```sql
CREATE TABLE IF NOT EXISTS followed_companies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);
```

Added to the existing `migrate()` in `src/db/index.ts`. Company matching is exact-name, case-insensitive.

## Server actions (`src/app/actions.ts`)

- `toggleFollowCompanyAction(formData)`: reads `company`, trims/caps length, inserts if absent else deletes; guards empty string. Extends `revalidateAll()` with `/following`.

## UI

- `ListingCard` + pipeline `PipelineCard`: star toggle next to company name using the existing `<form action={serverAction}>` pattern; hidden input carries the company name. Hidden when `company` is empty.
- Pages needing follow state fetch `SELECT name FROM followed_companies` once per render and pass a lowercase `Set<string>` down (no N+1).
- `/following/page.tsx`: header with followed-company chips (openings count + inline unfollow ✕), below it all open listings whose company is followed (SQL `EXISTS … COLLATE NOCASE`), newest first, reusing `ListingCard`. Empty state explains how to follow.
- Nav (`layout.tsx`): adds "Following".

## Applied nav fix

- New `src/app/applied/loading.tsx` skeleton mirroring the 3-column pipeline → fallback becomes prefetchable, navigation renders instantly, content streams in.
- Same treatment for the new `/following/loading.tsx`.

## Error handling

- Toggle action silently ignores invalid/empty input (consistent with existing actions).
- Unfollowing never touches listings; rows remain, only filtered out of `/following`.
- Missing/empty `listing.company` hides the follow control.

## Testing

- Existing vitest suites must stay green (`pnpm test`); lint clean (`pnpm lint`); `tsc --noEmit` clean.
- Runtime verification against the dev server: pages render (200), follow toggle persists in SQLite, `/following` reflects added/removed companies.
