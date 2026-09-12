# Job Descriptions End-to-End — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each job's description in the DB and let users expand it inline on the listing card, without visiting the external link.

**Architecture:** Add a `description` column to the `listings` table (via the existing lightweight-migration pattern), persist it at upsert, let the uncommitted JapanDev/TokyoDev detail-enrichment backfill missing rows in bounded batches, and render an inline native `<details>` in `ListingCard` reusing the existing `Highlight` component. No client JS, no new routes.

**Tech Stack:** TypeScript, Next.js 16 (App Router), node:sqlite, vitest, lucide-react.

> **Note on working tree:** This plan builds on the **uncommitted** JapanDev/TokyoDev WIP already present in `src/lib/adapters/index.ts`, `scrape.ts`, `normalize.ts`, `db/index.ts` seed boards, and their tests. Do **not** commit or discard that WIP while executing — it is a prerequisite. (Skill normally runs in a worktree, but branching would drop this uncommitted state, so we execute in place.)

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/adapters/normalize.ts` | Export `capDescription()` + `MAX_DESCRIPTION_LENGTH` helper (lives here beside `stripHtml` to avoid an import cycle with `refresh.ts`) |
| `src/db/index.ts` | Add `description` column to fresh-schema `CREATE TABLE`, to the `listings_fixed` repair table, to the `ListingRow` interface, to `rowToListing`, and to the lightweight `ALTER TABLE` migration |
| `src/lib/types.ts` | Add `description: string` to `Listing` and `FilterableListing` |
| `src/lib/refresh.ts` | `upsertListings` writes the capped description on insert |
| `src/lib/adapters/index.ts` | TokyoDev + JapanDev enrichment `UPDATE` statements also write `description` |
| `src/components/ListingCard.tsx` | Render inline `<details>` description section when non-empty |
| `tests/adapters.test.ts` | Unit test for `capDescription` |

Pages (`src/app/page.tsx`, `following`, `applied`, `bangladesh`) already use `SELECT l.*` so the new column flows into `rowToListing` automatically — no change needed there.

---

### Task 1: `capDescription` helper + test

**Files:**
- Modify: `src/lib/adapters/normalize.ts` (helpers area, near `stripHtml`)
- Test: `tests/adapters.test.ts`

- [ ] **Step 1: Write the failing test**

Open `tests/adapters.test.ts`, add to the top-level `describe("helpers", ...)` block (find the existing one that already tests `idFromUrl`):

```ts
import { capDescription } from "@/lib/adapters/normalize";
// ...inside describe("helpers", ...)
  it("caps over-long descriptions and passes short ones through", () => {
    expect(capDescription("short")).toBe("short");
    const long = "a".repeat(25_000);
    expect(capDescription(long)).toHaveLength(20_000);
    expect(capDescription(long)).toBe("a".repeat(20_000));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/adapters.test.ts`
Expected: FAIL — `capDescription` is not exported / not defined.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/adapters/normalize.ts`, add near the other helpers (after `stripHtml` / `toIsoDate` definitions):

```ts
/** Hard cap on stored description length, to bound list-page payloads (PAGE_SIZE = 20). */
export const MAX_DESCRIPTION_LENGTH = 20_000;

/** Truncate an over-long description; pass short ones through unchanged. */
export function capDescription(text: string): string {
  return text.length > MAX_DESCRIPTION_LENGTH ? text.slice(0, MAX_DESCRIPTION_LENGTH) : text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/adapters.test.ts`
Expected: PASS for the new `capDescription` test (and all existing adapter tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/adapters/normalize.ts tests/adapters.test.ts
git commit -m "feat: add capDescription helper for description storage"
```

---

### Task 2: DB schema — add `description` column

**Files:**
- Modify: `src/db/index.ts`
  - fresh `CREATE TABLE listings` ~ `src/db/index.ts:87-105`
  - `listings_fixed` repair table ~ `src/db/index.ts:146-166`
  - lightweight migration ~ `src/db/index.ts:196-201`
  - `ListingRow` interface ~ `src/db/index.ts:464-484`
  - `rowToListing` ~ `src/db/index.ts:486-512`

- [ ] **Step 1: Write nothing yet — verify current schema compiles after later type change.** (Schema edits only; covered by build in Task 7.) Proceed to edit the four spots.

- [ ] **Step 2: Add column to fresh `CREATE TABLE listings`**

In the `CREATE TABLE IF NOT EXISTS listings (...)` block, add `description` right after the `search_text` line:

```sql
      search_text      TEXT NOT NULL DEFAULT '',
      description      TEXT NOT NULL DEFAULT '',
      UNIQUE (board_id, external_id)
```

- [ ] **Step 3: Add column to the `listings_fixed` repair table**

In the `CREATE TABLE listings_fixed (...)` block (inside the broken-DB repair), add after its `search_text` line:

```sql
           search_text      TEXT NOT NULL DEFAULT '',
           description      TEXT NOT NULL DEFAULT '',
```

And in the matching `INSERT INTO listings_fixed (...) SELECT ... FROM listings` statements, add `description` to both column lists (the INSERT column list and the SELECT list), e.g.:

```sql
           id, board_id, external_id, title, company, location,
           is_remote, visa_sponsorship, remote_scope, tags, skills, url,
           posted_at, fetched_at, status, user_tags, search_text, description
         )
         SELECT id, board_id, external_id, title, company, location,
                is_remote, visa_sponsorship, remote_scope, tags, skills, url,
                posted_at, fetched_at, status, user_tags, search_text, description
         FROM listings
```

- [ ] **Step 4: Add the lightweight migration**

Right after the `if (!listingCols.includes("remote_scope")) { ... }` block (around `src/db/index.ts:199-201`), add:

```ts
  if (!listingCols.includes("description")) {
    db.exec("ALTER TABLE listings ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }
```

- [ ] **Step 5: Extend `ListingRow` + `rowToListing`**

In the `ListingRow` interface, add the field (next to `search_text?: string;`):

```ts
  search_text?: string;
  description?: string;
```

In `rowToListing`, add the mapping (next to `searchText: r.search_text ?? ""`):

```ts
    searchText: r.search_text ?? "",
    description: r.description ?? "",
```

- [ ] **Step 6: Commit**

```bash
git add src/db/index.ts
git commit -m "feat(db): add description column + migration + row mapping"
```

---

### Task 3: Types — add `description` to `Listing`

**Files:**
- Modify: `src/lib/types.ts` (`Listing` ~ line 23-42, `FilterableListing` ~ line 45-49)

- [ ] **Step 1: Read `src/lib/types.ts`** (already reviewed — `Listing` and `FilterableListing` interfaces).

- [ ] **Step 2: Add `description` to `Listing`**

Inside the `Listing` interface, add after the `userTags: string[];` field:

```ts
  url: string;
  postedAt: string | null;
  fetchedAt: string;
  status: ListingStatus;
  userTags: string[];
  /** job description text, persisted from the source (capped at 20k chars) */
  description: string;
```

- [ ] **Step 3: `FilterableListing` already extends `Listing`** so it gets `description` automatically — no change needed there.

- [ ] **Step 4: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors (any literal `Listing` construction missing `description` will surface here — fix by adding `description: ""` at those sites if any exist).

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add description to Listing"
```

---

### Task 4: `upsertListings` writes the description

**Files:**
- Modify: `src/lib/refresh.ts` (`upsertListings` ~ `src/lib/refresh.ts:76-115`)

- [ ] **Step 1: Import `capDescription`**

In `src/lib/refresh.ts`, update the import from normalize (currently `import { sanitizeTags } from "@/lib/adapters/normalize";`):

```ts
import { sanitizeTags, capDescription } from "@/lib/adapters/normalize";
```

- [ ] **Step 2: Add `description` to the INSERT**

In `upsertListings`, add `description` to the column list (after `user_tags`) and a bound value. The INSERT becomes:

```ts
  const stmt = db.prepare(`
    INSERT INTO listings (
      board_id, external_id, title, company, location,
      is_remote, visa_sponsorship, remote_scope, tags, skills, url, posted_at,
      fetched_at, status, user_tags, search_text, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '[]', ?, ?)
    ON CONFLICT (board_id, external_id) DO NOTHING
  `);
```

- [ ] **Step 3: Pass the capped value**

In the `stmt.run(...)` call, add `capDescription(l.description)` as the last bound argument (after `buildSearchText({...})`):

```ts
      buildSearchText({
        title: l.title,
        company: l.company,
        location: l.location,
        tags: l.tags,
        description: l.description,
      }),
      capDescription(l.description),
    );
```

- [ ] **Step 4: Type-check + test**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: tsc clean; existing tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/refresh.ts
git commit -m "feat(refresh): persist capped description on upsert"
```

---

### Task 5: Enrichment backfill writes `description`

**Files:**
- Modify: `src/lib/adapters/index.ts`
  - `fetchTokyoDev` UPDATE ~ lines 282-312 (WIP)
  - `fetchJapanDev` UPDATE ~ lines 460-495 (WIP)

- [ ] **Step 1: Import `capDescription`**

In `src/lib/adapters/index.ts`, update the normalize import (currently includes `idFromUrl, parseJapanDevDetail`, etc.):

```ts
import {
  detectVisaSponsorship,
  detectRemoteScope,
  idFromUrl,
  parseJapanDevDetail,
  capDescription,
} from "@/lib/adapters/normalize";
```

(Add `capDescription` to whatever the existing named list is — do not remove existing names.)

- [ ] **Step 2: TokyoDev UPDATE writes `description`**

In `fetchTokyoDev`, change the UPDATE statement and the bound params:

```ts
    const upd = db.prepare(
      "UPDATE listings SET search_text = ?, skills = ?, location = ?, posted_at = ?, description = ? WHERE board_id = ? AND external_id = ?",
    );
    for (const l of listings) {
      if (!l.description) continue;
      upd.run(
        buildSearchText({
          title: l.title,
          company: l.company,
          location: l.location,
          tags: l.tags,
          description: l.description,
        }),
        JSON.stringify(extractSkills({ title: l.title, tags: l.tags, description: l.description })),
        l.location,
        l.postedAt,
        capDescription(l.description),
        board.id,
        l.externalId,
      );
    }
```

- [ ] **Step 3: JapanDev UPDATE writes `description`**

In `fetchJapanDev`, change the UPDATE statement and the bound params:

```ts
    const upd = db.prepare(
      "UPDATE listings SET search_text = ?, skills = ?, visa_sponsorship = ?, description = ? WHERE board_id = ? AND external_id = ?",
    );
    for (const l of all) {
      if (l.description.length < 80) continue;
      upd.run(
        buildSearchText({
          title: l.title,
          company: l.company,
          location: l.location,
          tags: l.tags,
          description: l.description,
        }),
        JSON.stringify(extractSkills({ title: l.title, tags: l.tags, description: l.description })),
        l.visaSponsorship ? 1 : 0,
        capDescription(l.description),
        board.id,
        l.externalId,
      );
    }
```

- [ ] **Step 4: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/adapters/index.ts
git commit -m "feat(adapters): backfill description via JapanDev/TokyoDev enrichment"
```

---

### Task 6: Inline description in `ListingCard`

**Files:**
- Modify: `src/components/ListingCard.tsx` (imports ~ line 1; render between tags block end ~ line 182 and action bar ~ line 184)

- [ ] **Step 1: Add chevron icon to imports**

Change the lucide-react import to include `ChevronDown`:

```ts
import { Heart, Send, Eye, ExternalLink, MapPin, Building2, Globe, Plane, Star, ChevronDown } from "lucide-react";
```

- [ ] **Step 2: Render the `<details>` block**

Insert this immediately after the closing `</div>` of the tags block (the block ending at line 182, `)}` then `</div>`) and before the action-bar `<div className="mt-auto ...">`:

```tsx
      {listing.description && (
        <details className="group/desc rounded-xl border border-slate-200 bg-slate-50/60">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
            <ChevronDown className="h-4 w-4 transition-transform group-open/desc:rotate-180" />
            Description
          </summary>
          <div className="max-h-96 overflow-y-auto whitespace-pre-line px-3 pb-3 text-[13px] leading-relaxed text-slate-700">
            <Highlight text={listing.description} keywords={matched} />
          </div>
        </details>
      )}
```

(`matched` is already a prop on `ListingCard` and used by the existing `Highlight` for the title, so it is in scope.)

- [ ] **Step 3: Type-check + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: clean; `pnpm lint` reports no errors in `ListingCard.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/ListingCard.tsx
git commit -m "feat(ui): inline expandable job description on listing card"
```

---

### Task 7: Integration check, build, lint, verify

**Files:** (no source changes — verification only)

- [ ] **Step 1: Full build + lint + tests**

Run: `pnpm build`
Expected: Next.js build succeeds (compiles all pages including `SELECT l.*` consumers).

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm test`
Expected: all suites green (adapters, scrape, filters, navigation, skills, bd, bdjobs).

- [ ] **Step 2: Manual verification**

Run: `pnpm dev`, open the dashboard, trigger a refresh (the Refresh button / `/api/refresh`).
  - Boards whose list API already returns descriptions (RemoteOK, Remotive, Greenhouse, SmartRecruiters, Arbeitnow, Himalayas, BDJobs…): expand a card → full description visible immediately.
  - JapanDev / TokyoDev cards: description section appears after one or more refreshes (bounded enrichment: ≤30 JapanDev, ≤20 TokyoDev per refresh). Confirm Cloudflare-challenged TokyoDev rows simply lack the section until they succeed later.
  - Cards with no description (e.g., easy.jobs/scrapers that don't fetch it yet) render exactly as before — no section.

- [ ] **Step 3: Commit any follow-up fixes** (only if Task 7 surfaced a bug)

```bash
git add -p   # stage only the fix
git commit -m "fix: <short description of the fix>"
```

---

## Self-Review

**1. Spec coverage**
- DB column + migration + fresh schema + repair table → Task 2 ✅
- Capped write-time truncation (20k, in normalize.ts to avoid cycle) → Task 1 + Task 4 + Task 5 ✅
- `upsertListings` writes description → Task 4 ✅
- JapanDev/TokyoDev enrichment backfill writes description → Task 5 ✅
- Types `Listing`/`FilterableListing` gain `description` → Task 3 ✅
- Inline `<details>` reuse of `Highlight` → Task 6 ✅
- Errors/edge cases (enrichment non-blocking, progressive backfill, no section when empty) → covered by design + Task 7 manual steps ✅
- Testing (capDescription unit; existing suites stay green; lint/build) → Tasks 1, 4, 5, 6, 7 ✅

**2. Placeholder scan** — No TBD/TODO/"similar to"/"add validation" placeholders. Each code step shows exact code.

**3. Type consistency**
- `capDescription(text: string): string` and `MAX_DESCRIPTION_LENGTH` defined in Task 1, imported and used consistently in Tasks 4 & 5.
- `description: string` added once on `Listing` (Task 3); `FilterableListing extends Listing` so the same property is used in Task 6 (`listing.description`) — consistent.
- `rowToListing` returns `description` (Task 2) feeding `FilterableListing` (Task 3 type) — consistent.
- Enrichment UPDATE param order matches the column order (`search_text, skills, [visa_sponsorship|location, posted_at], description, board_id, external_id`) — verified against the existing WIP SQL shape.
