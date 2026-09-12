# International sources expansion — design (2026-08-30)

## Goal

Add international developer-job sources beyond the existing BD + Japan + worldwide-remote
boards, tuned for a Java-backend developer applying from Bangladesh:

1. jobs doable **remotely from Bangladesh** (worldwide-remote / contractor-friendly), and
2. jobs abroad where the employer **sponsors visas / relocates** (EU, UK, UAE, US).

**Direction from the user (binding):** new sources must ingest **broad tech listings**
(the source's own tech/dev category), NOT java-only feeds. Java narrowing happens in the
UI (global keywords, skill facets). The quality bar is therefore on **`skills` and
`description` being populated properly** so the site's own filters do the work — every new
adapter must deliver a real description (directly from the payload or via bounded detail
enrichment, the established pattern) so `extractSkills` + `buildSearchText` at upsert time
have material to work with.

Method follows the 2026-08-29 BD-sources precedent: probe each candidate live before
writing an adapter; explicit skip-list; graceful empty states; verification bar at the end.

## Research findings (live-probed 2026-08-30)

Already covered by existing boards (no change): RemoteOK `/api`, Remotive (×2),
HimalayasApp, Working Nomads, WWR backend RSS, Arbeitnow (DE), JapanDev, TokyoDev,
11 EU/US Greenhouse company boards. Worldwide-remote tier is therefore largely in place;
the gaps are UK, EU-relocation, and a broader remote-tech feed.

| Candidate | Probe result | Decision |
| --- | --- | --- |
| Jobicy v2 API (`/api/v2/remote-jobs?industry=engineering`) | ✅ 200 with our UA; full HTML `jobDescription`, `jobGeo`, `jobType/Level`, `pubDate`; `engineering` slug = "Software Engineering" | **Implement (api)** |
| Reed UK API (`reed.co.uk/api/1.0/search`) | ✅ 401 without key (API alive). Free key required (Basic auth). Search returns `jobId/employerName/jobTitle/locationName/salary range/datePosted dd/MM/yyyy/jobUrl`; details `/api/1.0/jobs/{id}` return `jobDescription` | **Implement (api, `REED_API_KEY`, seeded disabled)** |
| Arc.dev `/remote-jobs` | ✅ 200; `__NEXT_DATA__` carries `arcJobs` (vetted: title, `requiredCountries` ([] = worldwide), categories = skills, salary, `postedAt` unix, `urlString`+`randomKey`) and `externalJobs` (aggregated from other boards, `company.name`). No description in list. Detail `remote-jobs/details/{urlString}-{randomKey}` exposes `pageProps.job` with `description`, **`visaOrRelocationRequired`**, `pageProps.company`. External jobs: `remote-jobs/j/{urlString}-{randomKey}` | **Implement (scrape + detail enrichment)** |
| Relocate.me `/international-jobs` | ✅ 200 SSR; cards `jobs-list__job` with anchors `/{country}/{city}/{company}/{slug}-{numericId}`, 20/page, `?page=N` pagination. Detail pages embed JSON-LD JobPosting (`description`, `datePosted`). Relocation-native board — descriptions frequently mention visa/relocation support | **Implement (scrape + detail enrichment)** |
| JustJoin.it | ❌ listing page is client-rendered (RSC flight has no job data); private search API `api.justjoin.it` returns 503 (WAF) even with browser headers | Skip — record: private API blocked |
| Naukrigulf (`/java-jobs`) | ❌ connection-level bot wall: HTTP/2 stream reset with app UA, HTTP/1.1 + browser UA times out | Skip — record: network-level WAF |
| Relocate.me GitHub dataset (`AndrewStetsenko/tech-jobs-with-relocation`) | ❌ repo gutted — only LICENSE/README/visuals remain (curated lists moved behind a paid product) | Skip |
| RemoteOK per-tag JSON (`/remote-java-jobs.json`) | ✅ works, but java-only feed contradicts the broad-tech directive and RemoteOK `/api` is already seeded | Skip |
| Bayt, eFinancialCareers, Wellfound, Dice, Jobgether, BuiltIn, Seek, EURES | bot-walls / heavy JS / SPA without API (research session findings) | Skip (unchanged) |

Talent networks (Turing, Crossover, Toptal, Arc.dev vetted) are application platforms, not
feeds — out of scope except Arc.dev's public board.

## Changes

### 1. `normalize.ts` — two new API normalizers

- **`normalizeJobicy`** — maps `jobs[]`: `id` → externalId, `jobTitle`, `companyName`,
  `jobGeo` → location ("USA"/"Anywhere in the World"/… — `detectRemoteScope` classifies
  regions as restricted), `jobType`+`jobLevel` → tags, `pubDate` → postedAt,
  `stripHtml(jobDescription || jobExcerpt)` → description (full JD present in feed, so
  skills populate immediately). `isRemote: true`, visa via `detectVisaSponsorship`.
- **`normalizeReed`** — maps `results[]`: `jobId` → externalId, `jobTitle`,
  `employerName` → company, `locationName` → location, salary range → a `£45k ~ £60k`-style
  tag (JapanDev `yenRange` pattern), `datePosted` `dd/MM/yyyy` → ISO via
  `reedDateToIso`, `jobUrl`. Description empty — filled by detail enrichment.
  Reed search is UK-only by nature (location-bound → `remoteScope` null unless the title
 /location says remote).

### 2. `scrape.ts` — two new parsers

- **`parseArcJobs(html)`** — extract `__NEXT_DATA__` (tolerant index/substring parse),
  map `arcJobs` (url `https://arc.dev/remote-jobs/details/{urlString}-{randomKey}`,
  location = `requiredCountries` join or "Anywhere", tags = category names + salary tag)
  and `externalJobs` (url `https://arc.dev/remote-jobs/j/{urlString}-{randomKey}`,
  `company.name`).
- **`parseArcDetail(html)`** — `pageProps.job.description` (plain text),
  `visaOrRelocationRequired` → visa tri-state, `pageProps.company.name`.
- **`parseRelocateMe(html)`** — anchors
  `/{country}/{city}/{company}/{slug}-{id}` → title from the card's `job__title` (fallback:
  slug title-cased), location = "{City}, {Country}" (title-cased), company from path,
  externalId = numeric id. Cards under `/remote/…` are site promos (the paid curated-list
  ad), not jobs — skipped (found live on the first refresh).
- **`parseRelocateMeDetail(html)`** — JSON-LD JobPosting → `description` + `datePosted`
  (TokyoDev detail pattern). Live quirk: relocate.me pretty-prints its JSON-LD with raw
  newlines *inside* string values (invalid strict JSON), so the block is whitespace-
  collapsed before `JSON.parse`.

### 3. `adapters/index.ts` — dispatch + two enrichment fetchers

- `API_NORMALIZERS.jobicy = normalizeJobicy` (board name "Jobicy" → key "jobicy").
- `fetchApiListings`: name-based special case `Reed (UK)` → `fetchReed(board)`:
  throws a descriptive error when `REED_API_KEY` is unset (board is seeded disabled so
  this only surfaces if enabled early); Basic-auth `key + ":"`; paginates
  `resultsOffset` up to 200 results; enriches up to 30/refresh via `/api/1.0/jobs/{id}`
  (JapanDev-style bounded enrichment with immediate `UPDATE search_text, skills,
  visa_sponsorship, description`).
- `fetchScraped` host dispatch: `arc.dev` → `fetchArc(board)` (enrich up to 20/refresh —
  description, visa flag, company name when empty); `relocate.me` →
  `fetchRelocateMe(board)` (fetch pages 1–2, enrich up to 10/refresh — description,
  postedAt).

### 4. `db/index.ts` — seeds

All broad-tech, `keywords: []` (gated only by the user's global keywords in the UI):

- `Jobicy` (api) `https://jobicy.com/api/v2/remote-jobs?count=50&industry=engineering`
  — replaces the dead `Jobicy (Java tag)` RSS seed (stale row removed from the dev DB;
  fresh DBs never see it).
- `Arc.dev` (scrape) `https://arc.dev/remote-jobs`
- `Relocate.me` (scrape) `https://relocate.me/international-jobs`
- `Reed (UK)` (api) `https://www.reed.co.uk/api/1.0/search?keywords=developer&resultsToTake=100`
  — `enabled: false` until `REED_API_KEY` is set.

### 5. `facets.ts`

Extend the Poland facet with accented city spellings surfaced by relocation boards
(`warszawa`, `wrocław`, `poznań`). No other gaps: Relocate.me URLs yield country names
already in the vocabulary; UAE/UK/DE/SG/US all covered.

## Verification bar

- New normalizers/parsers covered by vitest fixtures (no network): field mapping, empty
  payloads, dd/MM/yyyy dates, visa flag tri-state, JSON-LD extraction.
- `tsc --noEmit` + full vitest suite green.
- Live: refresh every new board once; `last_status = ok · N fetched`; DB completeness —
  title/company/location/url 100%, description ≥80 chars for the enriching boards within
  a couple of refresh cycles, skills non-empty where descriptions exist.
- UI spot-check: `?remote=1` / `?visa=1`, country facets (United Kingdom, Netherlands,
  Poland, UAE), and Java keyword search hitting the new sources.
