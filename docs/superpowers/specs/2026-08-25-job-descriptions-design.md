# Job Descriptions End-to-End — Design

Date: 2026-08-25
Status: Approved

## Problem

JobRadar fetches listings from many boards, but the full job description is
discarded after being used to build `search_text` (first 2000 chars) and detect
skills. To learn anything about a role beyond title/tags, the user must open
the external job link. The user wants to read descriptions inside the app.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| How is the description read? | **Expand inline** on the listing card via native `<details>` — no navigation, no client JS |
| How are missing descriptions filled? | **Store + enrich at refresh** — persist what list APIs give; boards needing detail-page hits enrich a bounded batch each refresh |
| Storage/serve strategy | **Full text per row** (approach A) — capped at 20k chars; page payloads stay bounded (PAGE_SIZE = 20) |

## Current state (verified)

- `NormalizedListing.description` already exists; most API adapters
  (RemoteOK, Remotive, Greenhouse, SmartRecruiters, Arbeitnow, Himalayas,
  BDJobs) populate it. Scrapers for easy.jobs / nextjobz RSC leave it empty.
- The `listings` table has **no description column**; `search_text` keeps only
  a 2000-char lowercased snippet merged with other fields.
- Uncommitted WIP adds JapanDev + TokyoDev boards whose adapters already
  fetch descriptions from detail endpoints/pages purely to update
  `search_text`/`skills` — this work becomes the backfill mechanism.

## Design

### 1. Data layer (`src/db/index.ts`)

- Add column `description TEXT NOT NULL DEFAULT ''` to `listings`, following
  the existing lightweight migration pattern (`PRAGMA table_info` check +
  `ALTER TABLE ADD COLUMN`), so existing databases upgrade in place.
- Include the column in:
  - the fresh-install `CREATE TABLE listings`,
  - the `listings_fixed` repair-table path,
  - every row→listing mapping SELECT.
- Write-time cap: descriptions are truncated to `MAX_DESCRIPTION_LENGTH =
  20_000` chars via a small exported helper (`capDescription`) that lives in
  `src/lib/adapters/normalize.ts` beside `stripHtml` — deliberately NOT in
  refresh.ts, since `adapters/index.ts` (enrichment UPDATEs) needs it too
  and refresh.ts already imports from adapters, so the reverse import would
  be circular.

### 2. Fetch & persistence

- `upsertListings` (`src/lib/refresh.ts`) writes the capped description for
  new rows. Boards that already include descriptions in list payloads get
  them immediately on the next refresh.
- JapanDev and TokyoDev enrichment loops (uncommitted WIP in
  `src/lib/adapters/index.ts`) gain `description = ?` in their UPDATE
  statements, so rows inserted earlier (empty description) backfill in
  bounded batches: ≤30 jobs per refresh (JapanDev, plain JSON detail API),
  ≤20 jobs per refresh (TokyoDev, JSON-LD via headless browser).
- No generic enrichment framework: only these two boards require detail-page
  fetching today. easy.jobs / nextjobz can adopt the same pattern later if
  wanted (YAGNI).
- `search_text` construction is unchanged.

### 3. Types & query flow

- `Listing` and `FilterableListing` (`src/lib/types.ts`) gain
  `description: string`.
- Row→listing mapping selects the new column; pages pass it through to cards
  unchanged otherwise.

### 4. UI (`src/components/ListingCard.tsx`)

- When `listing.description` is non-empty, render between the tags row and
  the action bar:

  ```html
  <details>
    <summary>Description <chevron-icon></summary>
    <div class="max-h-96 overflow-y-auto whitespace-pre-line">
      <!-- description text with matched-keyword Highlight -->
    </div>
  </details>
  ```

- Reuses the existing `Highlight` component so filter keywords light up in
  descriptions just like titles/tags.
- Native `<details>`: zero client JS, keyboard accessible, consistent with
  the app's server-component style.
- Cards without descriptions render exactly as today.

### 5. Errors & edge cases

- Enrichment failures remain non-blocking (per-job try/catch in WIP code);
  affected cards simply lack the section until a later refresh succeeds.
- Rows predating this change start with `''` and backfill progressively;
  favorite/applied rows never expire, so they eventually fill too.
- Cloudflare challenges on TokyoDev detail pages retry on subsequent
  refreshes (existing behavior).

### 6. Testing & verification

- Unit tests (vitest):
  - capping helper truncates over-long descriptions and passes short ones;
  - TokyoDev/JapanDev fixture tests keep passing;
  - enrichment persistence covered via pure-function seams where practical.
- Existing suites stay green: `pnpm test`; lint clean: `pnpm lint`.
- Manual check: run a refresh, confirm cards show expandable descriptions on
  boards with list-API descriptions immediately, and JapanDev/TokyoDev cards
  fill in over successive refreshes.

## Out of scope

- Lazy on-click detail fetching (API route + client component).
- A dedicated `/jobs/[id]` detail page.
- Generic multi-board enrichment framework.
- Rendering raw HTML descriptions (all text stays stripped/plain).
