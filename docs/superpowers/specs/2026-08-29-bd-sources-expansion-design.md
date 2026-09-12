# Bangladesh Software-Dev Sources Expansion — Design

**Date:** 2026-08-29
**Status:** Implemented & live-verified

## Goal

Add Bangladesh software-dev companies as sources — from their career pages or
job platforms — with consistent fetching and complete data (title, company,
location, URL, postedAt where published, description, deadline where the
source exposes one).

## Research findings (probed live, 2026-08-29)

- **easy.jobs** is the dominant BD hiring ATS. Verified genuine BD tech
  tenants: vivasoft, chaldal, sheba, datasoft, konasl, pathao, leads
  (LEADS Corporation), dream71 (Dream 71), shohoz — all currently with zero
  open positions, which they render as an explicit "No open job positions"
  empty state. (Brain Station 23 already integrated and active.)
  Name-collision warning: `kaz.easy.jobs` is "Infinit Prospera", NOT Kaz
  Software; `solution.easy.jobs` is a Chinese firm — excluded.
- **Enosis Solutions** publishes a Pinpoint ATS RSS feed with structured
  content (deadline / department / location / compensation) — zero-code seed.
- **Southtech Group** runs a WordPress job portal with a feed (currently 0
  items — seeds cleanly, picks up future postings).
- **Riseup Labs** has a fully SSR career site (`/jobs/`) with per-job meta
  (type, vacancies, **deadline**) and full SSR JDs on detail pages.
- Skipped as unscrapable server-side (JS-rendered/obfuscated; their postings
  are already covered by the Bdjobs IT board): BJIT, SELISE, REVE, TigerIT,
  Therap, Kaz Software (Wix), Shohoz own-site, DataEdge (dead), Dohatec
  (broken IIS), LeadSoft (404). No BD tenants found on Workable/Lever.

## Changes

1. **easy.jobs empty state** (`scrape.ts`): `parseEasyJobs` returns `[]` when
   the page carries the "No open job positions" marker instead of throwing —
   tenants without openings report "ok · 0 fetched" and pick up jobs
   automatically when posted. Structural breakage (no marker, no links) still
   throws so board health stays observable.
2. **Riseup Labs scraper** (`scrape.ts` + `adapters/index.ts`):
   `parseRiseupLabs` splits `<div class="single-job">` blocks → title, URL,
   type/vacancy tags, `Deadline: <Month D, YYYY>` → ISO `deadline`;
   `parseRiseupLabsDetail` extracts the full JD from
   `fw-page-builder-content`. `fetchRiseupLabs` enriches up to 10 new
   descriptions per refresh (same bounded pattern as easy.jobs/Cefalo).
3. **RSS career-feed extras** (`normalize.ts` + `fetchRss`): new pure
   `extractFeedExtras(title, contentHtml)` detects line-anchored
   `Location:` / `Application Deadline:` labels — feeds that carry them get
   real location, deadline, and a content-derived remote flag; remote-board
   feeds without labels keep the legacy all-remote defaults. RSS descriptions
   are entity-decoded (`&amp;` artifacts from double-escaped
   `content:encoded`). Single-company RSS boards now get `company` filled
   from the board name (same convention as scrape boards).
4. **Seeds** (`db/index.ts`): 12 new BD boards — 9 easy.jobs tenants,
   2 RSS feeds, Riseup Labs — bringing BD coverage to 20 sources alongside
   Bdjobs IT, Brain Station 23, Cefalo, Tekarsh, Craftsmen, Nextjobz,
   Airwork, Talvette.

## Round 3 (user-named companies + skill.jobs platform)

- **WeDevs**: careers page exists but lists no structured openings ("apply
  anytime" + contact link) — not addable; postings flow via Bdjobs/Facebook.
- **GoZayaan**: no reachable careers endpoint (404s) — hires via Bdjobs.
- **hSenid BD**: site unreachable from this network — unverifiable, not added.
- **Miaki**: careers page is a "send your CV" landing, no listings.
- **Grameenphone**: career.grameenphone.com is WAF-blocked server-side
  ("Request Rejected" for every path).
- **Robi**: robicareer.com is an Angular SPA with an authenticated API
  (Azure AD); job-list endpoints not statically discoverable.
- **Banglalink**: careers page is client-rendered without accessible data.
- **Added: Skill.jobs (tech)** — general BD portal whose listing page embeds
  the newest ~25 jobs as schema.org JobPosting objects in the RSC flight
  payload (title, datePosted, validThrough deadline, hiring company, BD
  locality). New `parseSkillJobs` extracts them from the flight payload and
  `parseSkillJobsDetail` reads each detail page's JSON-LD for description +
  skills; titles filtered to tech roles (`isTechTitle`). One board, many
  real employers (payload carries actual company names). → **23 BD sources**.

## Round 2 (company-list sweep)

- Probed ~30 more companies (MNC hubs, telcos, fintechs, dev shops) via
  their ATS endpoints and career pages: Optimizely, Samsung R&D Bangladesh,
  Therap, Augmedix/Commure, SELISE, Orbitax, Grameenphone, Banglalink, Robi,
  bKash, Nagad, Upay, Kaz, BJIT, Tiger IT, REVE, Nascenia, Astha IT, DevXHub,
  TechnoVista, GenWeb2, Welldev, LeadSoft, DataEdge, Dohatec — all
  JS-rendered, unreachable, or without accessible job data server-side.
  Their Dhaka postings flow through the Bdjobs IT aggregator.
- **Added**: Bondstein Technologies (SmartRecruiters, 4 live postings),
  Daraz (easy.jobs tenant, currently empty) → **22 BD sources** total.
- `normalizeSmartRecruiters` now expands ISO-style country codes
  ("bd" → "Bangladesh") so locations read "Dhaka, Bangladesh".


## Verification

- 102/102 vitest tests pass (new: easy.jobs empty state, Riseup listing +
  detail + deadline parsing, feed extras extraction); `tsc --noEmit` clean;
  changed files lint clean.
- Live fetch of all 12 new boards: 10 ok with data (Riseup 15 listings, all
  15 with deadlines and descriptions after enrichment; Enosis 1 with
  deadline), 10 empty tenants reporting "ok · 0". DB completeness check:
  title/company/location/url 100% on every stored row.
- UI-verified: Riseup Labs cards render with company/location/vacancy tags
  and the amber "Closes in 2d" freshness badge driven by the new deadlines;
  the running scheduler picked up all 28 boards automatically.
