# Consumer REST API & API Key Management — Design

**Date:** 2026-09-12
**Status:** Implemented (see plan addendum for the mid-flight Postgres pivot —
storage landed on `postgres.js`/Neon via a `KeyStore` port, not `node:sqlite`)

## Goal

Let other applications consume jobradar's collected jobs as a data source: a
versioned REST API (`/api/v1`) that serves the job list with the same filter
semantics the dashboard uses, plus API key management (create / list / revoke)
so access can be granted per consumer and revoked individually.

## Open decisions (defaults taken in an unattended session)

Clarifying questions went unanswered; the recommended defaults were chosen:

1. **API scope:** jobs list + single-job detail + meta (facet values) endpoint.
2. **Data scope:** the full collected dataset minus hidden listings. The
   owner's global keywords (personal taste, e.g. "java") are NOT applied —
   consumers filter with their own query params.
3. **Key management:** an in-app page (`/api-keys`) with server actions.
4. **Rate limiting:** none in v1 (personal scale; auth + pagination first).
   Can be added later without breaking consumers.

## Alternatives considered

- **SQL-level filtering + FTS/cursor pagination** — scales further and avoids
  loading the pool, but duplicates filter semantics (country facets are
  computed in JS via regexes; `search_text` is a JS-built blob). At current
  volume (~4–5k listings) the in-memory pipeline is instant. Rejected for v1.
- **Full platform (OpenAPI docs, scopes, quotas, webhooks)** — over-engineered
  for personal use. Rejected (YAGNI); the DTO and key table leave room to add
  scopes/quotas later.

## Architecture

Reuse "the one true filter pipeline": `buildJobView` in
`src/lib/job-view.ts` already implements status/remote/visa/facets/search
filtering, dedupe (company+title), ordering, and pagination. The API calls it
with `globalKeywords = []` (everything matches) and a new optional `pageSize`
option (default stays 20 for the UI). No duplicated filter logic; UI behavior
is unchanged.

```
src/lib/job-view.ts        # + optional opts.pageSize (default 20) — only change
src/lib/api/keys.ts        # key generation, hashing, DB CRUD, authenticate(request)
src/lib/api/serialize.ts   # Listing → public DTO (drops personal fields)
src/lib/api/query.ts       # zod parse of query params → RawParams + pageSize
src/app/api/v1/jobs/route.ts        # GET list
src/app/api/v1/jobs/[id]/route.ts   # GET detail
src/app/api/v1/meta/route.ts        # GET facet values + counts
src/app/api-keys/page.tsx  # management UI + server actions (actions.ts)
src/components/CopyButton.tsx        # small client component for one-time secret
```

Route handlers follow the existing `/api/refresh` pattern:
`runtime = "nodejs"`, `dynamic = "force-dynamic"`. Dynamic route params are
`Promise<{ id: string }>` per this Next version's convention.

## API surface

All `/api/v1/*` routes require a valid key. Auth accepts
`Authorization: Bearer <key>` (primary) or `x-api-key: <key>`. Responses carry
permissive CORS (`Access-Control-Allow-Origin: *`, `OPTIONS` handled) so
browser-based consumers work too, and `Cache-Control: no-store`.

### `GET /api/v1/jobs`

Query params (repeatable ones may appear multiple times):

| Param     | Values                                   | Notes |
| --------- | ---------------------------------------- | ----- |
| `q`       | free text                                | matches title/company/location/tags/skills (same as UI) |
| `status`  | `new` \| `favorite` \| `applied`         | default: all non-hidden |
| `remote`  | `1` \| `anywhere` \| `restricted`        | |
| `visa`    | `1`                                      | visa sponsorship only |
| `skill`   | repeatable                               | |
| `country` | repeatable (facet values, e.g. `Germany`, `Remote · Anywhere`) | |
| `company` | repeatable                               | |
| `source`  | repeatable (board name)                  | |
| `page`    | ≥ 1 (default 1)                          | out-of-range pages clamp like the UI |
| `pageSize`| 1–200 (default 25)                       | |

Success `200`:

```json
{
  "data": [ { "id": 412, "source": "RemoteOK", "title": "Senior Java Engineer",
              "company": "Acme", "location": "Remote", "country": "Remote · Anywhere",
              "isRemote": true, "remoteScope": "anywhere", "visaSponsorship": false,
              "tags": ["java"], "skills": ["Java", "Spring"],
              "url": "https://…", "postedAt": "2026-09-10T…", "deadline": null,
              "fetchedAt": "2026-09-12T…", "externalId": "abc123",
              "description": "…" } ],
  "pagination": { "page": 1, "pageSize": 25, "total": 834, "totalPages": 34 },
  "generatedAt": "2026-09-12T10:00:00.000Z"
}
```

DTO excludes personal/workflow fields: `status`, `userTags`, `searchText`,
`boardFilterKeywords`, `boardId`. `country` is the computed facet value
(`countryFacetValue`) so consumers can filter by it without reimplementing the
location regexes. `description` is included by default (already capped at
20k chars at ingest).

### `GET /api/v1/jobs/:id`

Single job DTO; `404 {"error":"not_found"}` when missing or hidden.

### `GET /api/v1/meta`

Facet values + counts over the non-hidden pool (computed via `buildJobView`
with no selections): `{ total, skills: [{name,count}], countries: […],
companies: […], sources: […] }`. Consumers build their own filter UIs from
this instead of hardcoding values.

### Errors

`401 {"error":"unauthorized"}` (missing/unknown key) ·
`403 {"error":"revoked"}` (key revoked) ·
`400 {"error":"invalid_params","details":…}` (bad query params) ·
`404 {"error":"not_found"}` · `405` non-GET on v1 routes.

## API keys

New table (additive `CREATE TABLE IF NOT EXISTS` migration in `src/db/index.ts`):

```sql
CREATE TABLE IF NOT EXISTS api_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,   -- sha256 hex of the full key
  prefix        TEXT NOT NULL,          -- first 12 chars, for UI display
  created_at    TEXT NOT NULL,
  last_used_at  TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  revoked_at    TEXT
);
```

- **Format:** `jrk_` + 32 random bytes base64url (~43 chars) via `node:crypto`.
- **Storage:** only the sha256 hash is persisted; the full key is shown once
  at creation (classic "shown once" pattern). Revocation sets `revoked_at`.
- **Verification:** hash the presented key, look it up; `revoked_at != null`
  → 403. `last_used_at` / `request_count` are updated best-effort (write is
  throttled to once per key per 60s to avoid a write on every request).
- **Management UI** (`/api-keys`): server component lists keys (name, prefix,
  created, last used, request count, revoked state); server actions
  `createApiKey(name)` (returns the plaintext once, rendered with a copy
  button) and `revokeApiKey(id)` (with confirm). Link added to `AppHeader`.
  The rest of the app has no auth either, so the page adds none; if the app
  is ever exposed publicly, management-page protection is a separate concern.

## Error handling

Handlers never throw raw: DB errors → `500 {"error":"internal"}`. All JSON
bodies use the `{ "error": string }` shape above. Auth runs before any DB
listing read, so unauthenticated traffic never touches the listings pool
beyond the key lookup.

## Testing

- `tests/api-keys.test.ts`: key format/uniqueness, hash round-trip,
  create/list/revoke CRUD against a temp DB, authenticate() accept/401/403,
  usage-stats throttle.
- `tests/api-jobs.test.ts`: route handlers invoked directly with `Request`
  objects (route handlers are plain functions): filters (q/remote/visa/
  facets/status), pagination clamps + pageSize bounds, DTO field allowlist
  (personal fields absent), meta counts, 404 on hidden/missing id, 401/403
  auth matrix. Existing tests keep passing unchanged (`pageSize` default 20).

## Out of scope (future)

Rate limiting/quota per key, key scopes, OpenAPI schema/docs page, cursor
pagination, webhook/push delivery.
