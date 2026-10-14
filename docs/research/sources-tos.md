# Board sources: ToS, robots.txt, and official API/RSS (P4.5)
**Decision / answer:** Keep the Greenhouse, WeWorkRemotely/RSS, Himalayas, Jobicy, Remotive, RemoteOK, Arbeitnow, Nextjobz, Enosis and Southtech feeds, with the attribution and polling limits below. Disable Reed (robots.txt disallows `/api/`) and the two SmartRecruiters seeds (robots.txt has `User-agent: *` / `Disallow: /` on `api.smartrecruiters.com`), pending permission. Treat the easy.jobs tenants, Tekarsh, Talvette, Airwork and the HTML scrapers as unverified (ToS not reachable). Check status codes and ToS before enabling.

Checked 2026-10-14. robots.txt was fetched with UA `JobRadarBot/1.0 (+https://localhost/bot)`. "Allowed?" is the robots.txt result for the endpoint we hit, plus any ToS clause found. ToS "unverified" means the page returned 403/404 or could not be found.

## Details

| Source | Endpoint we hit (adapter) | Allowed? | API available | Recommendation |
|---|---|---|---|---|
| Greenhouse (SumUp, HelloFresh, Coinbase, Neo4j, Wise, Databricks, Okta, Twilio, N26, GetYourGuide, Celonis) | `GET boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true` | Yes. robots only disallows `/embed/`. Docs say GET is public, no auth. | Yes, the Job Board API (docs.greenhouse.io/job-board.html) | Keep. Use the API only. |
| SmartRecruiters (Craftsmen, Bondstein) | `GET api.smartrecruiters.com/v1/companies/{co}/postings` | **No** for generic UA. robots: `User-agent: *` / `Disallow: /`; only LinkedInBot is allowed on `/v1/companies/`. Posting API docs describe it as public, but do not state a unauthenticated usage grant. | Yes, but robots conflicts with it | Disable both seeds, or ask SmartRecruiters for permission. |
| RemoteOK | `GET remoteok.com/api` | Yes. robots `Allow: /`, `Crawl-delay: 1`. | Yes, the `/api` JSON | Keep. Must link back (followable, not nofollow) and credit "Remote OK" or API access is suspended. |
| Remotive | `GET remotive.com/api/remote-jobs?…` | Unverified. robots.txt returns 403 (Cloudflare challenge) to our UA. | Yes, documented public API, no key | Keep, at most 4 fetches/day (docs). Do not exceed 2/min. Link back and credit "Remotive". Jobs are delayed 24h. Do not submit to third parties. |
| Arbeitnow | `GET arbeitnow.com/api/job-board-api` | Yes. robots `Disallow:` empty (allow all). | Yes, free, no key | Keep. Link back to arbeitnow.com (ToS s.11). Site ToS s.2 bars commercial use of site materials, and API commercial status is unclear. Ask before any commercial use. |
| Himalayas | `GET himalayas.app/jobs/api` | Yes. robots disallows only `/apply`, `/jobs?page=`, etc., not `/jobs/api`. | Yes, no key | Keep. Cache 24h (API refreshes daily). Link to himalayas.app and cite source. On 429, back off. |
| Working Nomads | `GET workingnomads.com/api/exposed_jobs/` | Yes. robots `Disallow:` empty. | Feed exists, no key (per third-party descriptions) | Keep, but ToS and attribution unverified. Contact them before redistribution. |
| WeWorkRemotely (Backend RSS) | `GET weworkremotely.com/categories/remote-back-end-programming-jobs.rss` | Yes. robots `Allow: /`. | Yes, RSS | Keep. Poll slowly. ToS unverified (`/terms` returned 403). |
| Jobicy | `GET jobicy.com/api/v2/remote-jobs?count=50&industry=engineering` | Yes. robots disallows only `*api_access_key=` and blocked-bot list. | Yes, v2 API, no key | Keep. Max 1 sync pass/hour. Credit Jobicy and link the original job URL. Treat `jobDescription` as HTML and sanitize. Handle 429. |
| Reed (UK) | `GET reed.co.uk/api/1.0/search` and `/jobs/{id}` | **No** for crawlers. robots: `User-agent: *` / `Disallow: /api/`. Official API uses Basic auth with a key, which is the sanctioned route, but robots.txt still disallows the path. Site ToS bars commercial copying. | Yes, key required | Keep disabled. Enable only after a Reed decision on permission. |
| Arc.dev | `GET arc.dev/remote-jobs` (HTML `__NEXT_DATA__`) and detail pages | Yes. robots `Allow: /`. ToS page returned 404. | No | Keep, at a polite rate. Unverified ToS. Ask Arc before wide use. |
| Relocate.me | `GET relocate.me/international-jobs` and detail pages | Yes. robots `Disallow` only `/install/`, `/manager/`, `/uploads/`. ToS returned 404. | No | Keep, at a polite rate. Unverified ToS. |
| TokyoDev | `GET tokyodev.com/jobs` and company job pages | robots allows `/jobs`. **Server returns 403 to our UA**, so the adapter is currently blocked. | No | Investigate the 403 before enabling. Do not work around bot checks. ToS unverified (terms page 403). |
| JapanDev | `GET api.japan-dev.com/api/v1/jobs?page=N` and `/jobs/{slug}` | Yes. Site robots disallows only a salary PDF and `/blog/…`. API returns 200. | No official docs found; undocumented | Keep, but confirm with operator. Low volume only. |
| BDJobs IT | `GET api.bdjobs.com/Jobs/api/JobSearch/GetJobSearch?category=8` | Unverified. `jobs.bdjobs.com/robots.txt` allows `/` for `*` with `Disallow:` on app/data paths. API host has no robots.txt. | Undocumented JSON API | Keep, but ask for permission. |
| Tekarsh | `GET tekarsh.com/api/admin/jobs?limit=1000` | Unverified. No robots.txt (Next 404 page). Path is `/api/admin/…`, which looks internal. | Undocumented | Gray. Confirm it is intended as public before enabling. |
| Airwork BD | `GET ignition.airwork.ai/api/v2/public/jobs` | Unverified. No robots.txt (404). Endpoint name says "public". | Public-looking API, undocumented | Keep, ask permission. |
| Talvette | `GET api.sheety.co/…/liveJobs` (Sheety JSON over a user's Google Sheet) | Unverified. Sheety ToS not checked. | Sheety JSON endpoint (user-owned) | Keep, low volume. Owner is an individual, so ask them. |
| easy.jobs tenants (Brain Station 23, Vivasoft, Chaldal, Sheba, Datasoft, KONA, Pathao, LEADS, Dream 71, Shohoz, Daraz) | HTML pages on `{tenant}.easy.jobs/` | Unverified. Tenant subdomains have no robots.txt (404). Root easy.jobs robots disallows only WP admin. ToS s.2 allows "one copy… for personal, non-commercial use". | No public API seen | Gray. Keep at low rate, or ask easy.jobs. |
| Skill.jobs | `GET skill.jobs/browse-jobs` | Unverified. robots has no Disallow lines, only content-signal comments (values not visible in our fetch). ToS returned 404. | No | Keep, ask for permission. Content-signal values need a check. |
| Nextjobz BD | `GET nextjobz.com.bd/it-jobs` and sitemap `sitemap-job-details.xml` | Yes. robots disallows `/job-search` and account paths. | No | Keep. |
| Cefalo (careers) | `GET career.cefalo.com/` | Unverified. No robots.txt (404). | No | Keep at low rate. Ask company. |
| Riseup Labs | `GET riseuplabs.com/jobs/` | Yes. robots disallows only wp-admin and case-study paths. | No | Keep. |
| Enosis Solutions | `GET careers.enosisbd.com/jobs.rss` | Yes. robots disallows `/mydata`, `/admin`, `/companies`. | Yes, RSS | Keep. |
| Southtech Group | `GET career.southtechgroup.com/feed/` | Yes. robots disallows only wp-admin. | Yes, WordPress RSS | Keep. |

**User-Agent.** Replace the current browser-style UA in `src/lib/adapters/index.ts` (`Mozilla/5.0 … JobRadar/1.0 (+https://localhost)`) with the P4.6 format: `JobRadarBot/1.0 (+<APP_URL>/bot)`. The `<APP_URL>` must be a live URL with a page at `/bot` that states the contact address. The `/bot` page must exist before launch.

**robots.txt caching.** Fetch `${origin}/robots.txt` once per origin (scheme plus host). Cache the parsed result for 24h, keyed by origin. Use the same UA token as the group for matching. Follow RFC 9309: a 4xx response means no restrictions. A 5xx or network error means treat the origin as disallowed for a short retry window, rather than failing open. Check each URL before fetch, and log a skipped board as its status. Do not cache failures beyond the retry window. The parser library is unverified.

## Gotchas
- The `Disallow: /` rule for SmartRecruiters is for all agents. Under RFC 9309, it applies to our endpoint.
- Remotive returns a Cloudflare 403 to some clients, so its robots.txt could not be read. Re-check before enabling.
- Reed's API is official and keyed, but robots still disallows `/api/`. Ask Reed before treating that as permission.
- Several ToS pages returned 404 or 403 (WeWorkRemotely, Arc, Relocate.me, TokyoDev, Skill.jobs, Working Nomads, Cefalo, Airwork). Those rows are unverified, not "allowed".
- Several APIs carry attribution or link-back clauses (RemoteOK, Remotive, Arbeitnow, Himalayas, Jobicy). These are conditions of continued access, so the UI must show the source and link.
- Polling caps: Remotive 4/day, Jobicy 1/hour, Himalayas 24h cache, RemoteOK crawl-delay 1s.

## Sources
- `https://{host}/robots.txt` (fetched 2026-10-14 with JobRadarBot UA) for remoteok.com, arbeitnow.com, himalayas.app, workingnomads.com, weworkremotely.com, jobicy.com, arc.dev, relocate.me, reed.co.uk, tokyodev.com, api.smartrecruiters.com, boards-api.greenhouse.io, riseuplabs.com, skill.jobs, nextjobz.com.bd, careers.enosisbd.com, career.southtechgroup.com, japan-dev.com, jobs.bdjobs.com, easy.jobs, vivasoft.easy.jobs (404)
- https://remoteok.com/api — legal notice (link back, followable, credit "Remote OK", suspension if not)
- https://github.com/remotive-com/remote-jobs-api — rate limits (4/day, 2/min), attribution, 24h delay, no key
- https://arbeitnow.com/en/terms — s.11 link-back, s.2 commercial restriction (via WebFetch summary, not verified line by line)
- https://himalayas.app/docs/remote-jobs-api — no key, 24h cache, attribution, 429
- https://jobicy.com/jobs-rss-feed — keyless, 1/hour sync, credit and link, HTML description
- https://www.reed.co.uk/developers/jobseeker — Basic auth key, search and detail endpoints
- https://docs.greenhouse.io/job-board.html — GET endpoints public, no auth
- https://developers.smartrecruiters.com/docs/posting-api and /docs/endpoints-reference — posting API, no usage grant stated
- https://easy.jobs/terms — s.2 personal non-commercial single copy
- https://www.reed.co.uk/terms-and-conditions — site ToS: no copying for commercial use; third-party data disclaimer. No explicit scraping clause in first 100k chars; the API key route is the sanctioned one
- Returned 404/403 (no ToS read): arc.dev/terms-of-service (404), relocate.me/terms (404), skill.jobs/terms (404), tokyodev.com/terms (403), weworkremotely.com/terms (403), japan-dev.com/api (404), workingnomads.com/api (404)
