# JobRadar Consumer API — Integration Spec

**Version:** v1 (`/api/v1`) · **Status:** Live in `main` · **Last updated:** 2026-09-12

This document is for developers of external applications that want to consume
JobRadar's aggregated job feed as a data source. It describes authentication,
every endpoint, the exact response shapes, and integration recipes.

## 1. Getting started

1. **Request an API key** from the JobRadar owner. Keys are created in the
   JobRadar web UI under **API Keys** (`/api-keys`) and are shown **once** at
   creation — store it in your secret manager immediately. A key looks like:

   ```
   jrk_Vjh9xQ2tLm-Bk3Zf8wRnT0cY5uHs1eAo7dKpXgMq2iN
   ```

   (`jrk_` prefix + 43 URL-safe base64 characters). Only a SHA-256 hash is
   stored server-side; a lost key cannot be recovered, only replaced.

2. **Authenticate every request** with either header:

   ```
   Authorization: Bearer <key>
   x-api-key: <key>
   ```

   `Authorization: Bearer` is preferred. Unknown or missing keys get `401`;
   revoked keys get `403` — revocation is immediate, there is no grace period.

3. **Discover the vocabulary** with `GET /api/v1/meta`, then **pull jobs** with
   `GET /api/v1/jobs` (see §3, §4).

**Base URL** — wherever JobRadar is hosted: `http://localhost:3000` in local
development, the owner's deployment URL in production.

## 2. Conventions

- All responses are `application/json`.
- All timestamps are ISO 8601 strings in UTC (e.g. `2026-09-12T10:00:00.000Z`).
- Every response carries `Cache-Control: no-store` — always treat responses as
  fresh; don't share them between users of a public client (they all share one
  key).
- CORS is fully open (`Access-Control-Allow-Origin: *`; `OPTIONS` preflight
  returns `204` with `Allow-Headers: Authorization, x-api-key`), so browser
  apps can call the API directly. **Warning:** a browser app embeds the key in
  client-side code — prefer a thin server-side proxy so the key never ships to
  users.
- Errors use one shape: `{ "error": "<code>", "details"?: "<message>" }`.

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_params` | A query param failed validation; `details` names the problem |
| 401 | `unauthorized` | Missing or unknown key |
| 403 | `revoked` | Key was revoked |
| 404 | `not_found` | Job id doesn't exist or is hidden |
| 405 | — | Non-`GET` method on a v1 route |

- **Versioning:** breaking changes (field removals/renames, semantic changes)
  would ship under `/api/v2`. Within v1, changes are additive only: new fields
  may appear in responses — ignore unknown fields.
- **Rate limits:** none enforced in v1. Poll at most a few times per hour;
  `meta` changes slowly, cache it client-side.

## 3. `GET /api/v1/jobs` — the job feed

### Query parameters

Filters combine with AND. Repeatable params may be supplied multiple times
(`?skill=Java&skill=Spring`) and match if **any** value hits (OR within a
param). Unknown params are ignored.

| Param | Type | Semantics |
| --- | --- | --- |
| `q` | string, ≤300 chars | Case-insensitive substring over title, company, location, tags, skills (not the description) |
| `status` | `new` \| `favorite` \| `applied` | Curator workflow state. Default: all states. `hidden` jobs are never returned |
| `remote` | `1` \| `anywhere` \| `restricted` | `1` any remote; `anywhere` = work from any country; `restricted` = remote but region-limited |
| `visa` | `1` | Only jobs flagged as offering visa sponsorship |
| `skill` | repeatable, ≤30 values | Matches the extracted skill vocabulary (e.g. `Java`, `Spring`, `Docker`) — discover values via `/api/v1/meta` |
| `country` | repeatable, ≤30 values | Facet country: a mapped country name (`Germany`), `Remote · Anywhere`, or `Other` |
| `company` | repeatable, ≤30 values | Exact company name |
| `source` | repeatable, ≤30 values | Source board name (e.g. `RemoteOK`, `Remotive`) — discover via `/api/v1/meta` |
| `page` | integer ≥1 (default 1) | Pages beyond the last clamp to the last page |
| `pageSize` | integer 1–200 (default 25) | |

**Ordering and dedupe:** newest first by `postedAt` (falling back to
`fetchedAt`). Duplicate postings of the same role at one company (same
company + title, e.g. multi-location posts) are collapsed to one entry.

### Response `200`

```json
{
  "data": [
    {
      "id": 412,
      "source": "RemoteOK",
      "externalId": "a1B2c3D4",
      "title": "Senior Java Engineer",
      "company": "Acme",
      "location": "Remote",
      "country": "Remote · Anywhere",
      "isRemote": true,
      "remoteScope": "anywhere",
      "visaSponsorship": false,
      "tags": ["java", "backend"],
      "skills": ["Java", "Spring"],
      "url": "https://remoteok.com/jobs/a1B2c3D4",
      "postedAt": "2026-09-10T08:30:00.000Z",
      "deadline": null,
      "fetchedAt": "2026-09-12T02:00:11.000Z",
      "description": "…plain-text job description (≤20k chars)…"
    }
  ],
  "pagination": { "page": 1, "pageSize": 25, "total": 834, "totalPages": 34 },
  "generatedAt": "2026-09-12T10:00:00.000Z"
}
```

### Field dictionary

| Field | Type | Notes |
| --- | --- | --- |
| `id` | number | JobRadar's stable internal id — use as your primary key / detail lookup |
| `source` | string | Board the job came from |
| `externalId` | string | The job's id **on the source board** — use to dedupe against other feeds |
| `title`, `company`, `location` | string | As scraped; `location` is free-form |
| `country` | string | Normalized facet value — filterable via the `country` param |
| `isRemote` | boolean | |
| `remoteScope` | `"anywhere"` \| `"restricted"` \| `null` | `null` = not remote |
| `visaSponsorship` | boolean | Only meaningful where the source exposes it |
| `tags` | string[] | Source-board tags |
| `skills` | string[] | Skills extracted from title/tags/description (curated vocabulary) |
| `url` | string | Apply URL — always link out to this |
| `postedAt` | string \| null | Source-reported posting time; `null` when unknown |
| `deadline` | string \| null | Application deadline; only some sources expose one |
| `fetchedAt` | string | When JobRadar last ingested this listing |
| `description` | string | Plain-text-ish description, capped at 20,000 chars; may be empty for list-only sources |

Personal curation fields (star/hidden/user tags) are deliberately **not**
exposed.

## 4. `GET /api/v1/jobs/:id` — single job

`200` → `{ "data": <Job>, "generatedAt": "…" }` (same shape as a list item).
`404` → the id doesn't exist or the listing is hidden.

## 5. `GET /api/v1/meta` — facet vocabulary

```json
{
  "total": 834,
  "skills":    [{ "name": "Java", "count": 141 }, { "name": "Spring", "count": 87 }],
  "countries": [{ "name": "Germany", "count": 63 }, { "name": "Remote · Anywhere", "count": 410 }],
  "companies": [{ "name": "Acme", "count": 12 }],
  "sources":   [{ "name": "RemoteOK", "count": 210 }],
  "generatedAt": "2026-09-12T10:00:00.000Z"
}
```

Counts cover all non-hidden jobs. Every value returned here is a valid filter
value for the matching query param — build pickers from this instead of
hardcoding.

## 6. Recipes

### curl

```bash
KEY="jrk_…"

# everything, newest first
curl -H "Authorization: Bearer $KEY" "https://…/api/v1/jobs?pageSize=50"

# remote Java jobs with visa sponsorship
curl -H "x-api-key: $KEY" \
  "https://…/api/v1/jobs?skill=Java&skill=Spring&remote=anywhere&visa=1"

# two sources, page 2
curl -H "Authorization: Bearer $KEY" \
  "https://…/api/v1/jobs?source=RemoteOK&source=Remotive&page=2&pageSize=25"
```

### Incremental sync (recommended)

```ts
const BASE = "https://…";
const KEY = process.env.JOBRADAR_KEY!;

export async function pollJobs(since?: string) {
  const out = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `${BASE}/api/v1/jobs?page=${page}&pageSize=200`, // add &q=… or facets as needed
      { headers: { authorization: `Bearer ${KEY}` } },
    );
    if (res.status === 403) throw new Error("key revoked — request a new one");
    if (!res.ok) throw new Error(`jobradar ${res.status}`);
    const { data, pagination } = await res.json();
    out.push(...data);
    if (page >= pagination.totalPages) break;
  }
  // fetchedAt/created ordering means "new since last poll" ≈
  // filter client-side: out.filter(j => !since || j.fetchedAt > since)
  return out;
}
```

Notes for sync jobs:
- Upsert on `id`; use `externalId` + `source` to dedupe against other feeds.
- A listing can disappear from the feed only by being hidden — if you cache,
  reconcile by dropping ids you haven't seen after a full walk, or accept some
  staleness.
- `meta` once per hour at most; facet vocabularies change slowly.

## 7. Operational notes

- **Key lifecycle:** created/revoked by the JobRadar owner in the web UI.
  Treat revocation as immediate. If you see `403`, stop polling — don't retry
  with the same key.
- **Data freshness:** JobRadar ingests boards on its own schedule (cron/manual
  refresh). `fetchedAt` per job and `generatedAt` per response tell you how
  fresh a payload is.
- **Traffic:** unauthenticated traffic never reaches job data; abusive
  polling may cause the owner to revoke your key (there is no hard rate limit
  in v1).
- **Privacy:** the feed contains public job postings only. `description`
  content is the source boards' — respect their terms when republishing.
