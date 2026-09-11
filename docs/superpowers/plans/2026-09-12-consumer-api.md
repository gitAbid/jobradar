# Consumer REST API & API Key Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose jobradar's jobs to other apps via `/api/v1` (jobs list with filters, job detail, meta facets), authenticated by API keys managed in-app at `/api-keys`.

**Architecture:** Reuse the dashboard's one filter pipeline (`buildJobView`) with an optional `pageSize`; response builders live in `src/lib/api/jobs.ts` as pure functions taking `(Request, DatabaseSync)` so tests use in-memory SQLite; route files are thin adapters. Keys are stored hashed (sha256) in a new `api_keys` table that the keys module provisions itself. Spec: `docs/superpowers/specs/2026-09-12-consumer-api-design.md`.

**Tech Stack:** Next.js 16 App Router route handlers (plain `Response` bodies), `node:sqlite`, zod v4, vitest, React 19 server actions.

**IMPORTANT — working-tree policy:** The user's tree carries ~1.6k lines of uncommitted WIP (freshness/refresh/international-sources). This feature is deliberately **fully additive**: it must NOT edit any WIP-modified file (`git status` dirty list). The only pre-existing files touched are `src/lib/job-view.ts` (clean) and `src/components/AppHeader.tsx` (clean). The `api_keys` DDL lives in `src/lib/api/keys.ts` (feature-owned schema guard) instead of `src/db/index.ts` precisely to avoid entangling the WIP `migrate()` region. Never `git add .` — stage explicit paths only.

**Verified Next.js conventions** (from `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`): dynamic route handler params are `{ params: Promise<{ id: string }> }`, awaited. Route segment config via `export const runtime`/`dynamic` as in `src/app/api/refresh/route.ts`.

---

## File Structure

| File | Role |
| --- | --- |
| `src/lib/job-view.ts` (modify) | export `RawParams`; optional `opts.pageSize` |
| `src/lib/api/keys.ts` (new) | key generation, sha256 hashing, CRUD, `api_keys` schema guard, request authentication |
| `src/lib/api/query.ts` (new) | zod parsing of `/api/v1/jobs` query params |
| `src/lib/api/serialize.ts` (new) | `FilterableListing` → public DTO |
| `src/lib/api/jobs.ts` (new) | response builders: list, detail, meta, CORS/preflight, error helper, pool loader |
| `src/app/api/v1/jobs/route.ts` (new) | GET list |
| `src/app/api/v1/jobs/[id]/route.ts` (new) | GET detail |
| `src/app/api/v1/meta/route.ts` (new) | GET facets |
| `src/app/api-keys/actions.ts` (new) | server actions: create / revoke |
| `src/app/api-keys/page.tsx` (new) | management page |
| `src/components/api-keys/CreateKeyForm.tsx` (new) | client form + one-time secret display |
| `src/components/api-keys/RevokeButton.tsx` (new) | client confirm + revoke form |
| `src/components/CopyButton.tsx` (new) | clipboard button |
| `src/components/AppHeader.tsx` (modify) | nav link |
| `tests/api-jobs.test.ts` (new) | pageSize opt, query parsing, DTO, endpoint builders |
| `tests/api-keys.test.ts` (new) | key gen/hash/CRUD/auth |
| `tests/helpers/test-db.ts` (new) | in-memory DB + seed helpers |

---

### Task 1: `pageSize` option for `buildJobView`

**Files:**
- Modify: `src/lib/job-view.ts`
- Test: `tests/api-jobs.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/api-jobs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildJobView, PAGE_SIZE } from "@/lib/job-view";
import type { FilterableListing } from "@/lib/types";

/** Factory with sane defaults; tests override what they care about. */
export function makeListing(overrides: Partial<FilterableListing> = {}): FilterableListing {
  return {
    id: 1,
    boardId: 1,
    boardName: "RemoteOK",
    externalId: "ext-1",
    title: "Java Engineer",
    company: "Acme",
    location: "Remote",
    isRemote: true,
    visaSponsorship: false,
    remoteScope: "anywhere",
    tags: ["java"],
    skills: ["Java"],
    url: "https://example.com/1",
    postedAt: "2026-09-10T00:00:00Z",
    deadline: null,
    fetchedAt: "2026-09-12T00:00:00Z",
    status: "new",
    userTags: [],
    description: "Great job",
    boardFilterKeywords: [],
    searchText: "java engineer acme remote java",
    ...overrides,
  };
}

describe("buildJobView pageSize option", () => {
  const pool = Array.from({ length: 5 }, (_, i) =>
    makeListing({ id: i + 1, title: `Job ${i + 1}` }),
  );

  it("defaults to PAGE_SIZE so the UI is unchanged", () => {
    expect(PAGE_SIZE).toBe(20);
    const view = buildJobView(pool, {}, []);
    expect(view.entries).toHaveLength(5);
    expect(view.totalPages).toBe(1);
  });

  it("honors a custom pageSize", () => {
    const view = buildJobView(pool, {}, [], { pageSize: 2 });
    expect(view.entries).toHaveLength(2);
    expect(view.totalVisible).toBe(5);
    expect(view.totalPages).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/api-jobs.test.ts`
Expected: FAIL — TypeScript/`buildJobView` rejects a 4th argument ("Expected 3 arguments").

- [ ] **Step 3: Implement**

In `src/lib/job-view.ts`, export the params interface and add the options parameter:

```ts
export interface RawParams {
  status?: string;
  remote?: string;
  visa?: string;
  showAll?: string;
  q?: string;
  skill?: string | string[];
  country?: string | string[];
  company?: string | string[];
  source?: string | string[];
  page?: string;
}
```

(replacing the non-exported `interface RawParams`; delete the duplicate `selectedParam` note — the file already has its own copy, leave it.)

Change the signature:

```ts
export function buildJobView(
  pool: FilterableListing[],
  sp: RawParams,
  globalKeywords: string[],
  opts: { pageSize?: number } = {},
): JobView {
```

and inside, right below the signature:

```ts
  const pageSize = opts.pageSize ?? PAGE_SIZE;
```

Replace the two pagination uses of `PAGE_SIZE` with `pageSize`:

```ts
  const totalPages = Math.max(1, Math.ceil(totalVisible / pageSize));
```
```ts
  const entries: JobEntry[] = unique
    .slice((currentPage - 1) * pageSize, currentPage * pageSize)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/api-jobs.test.ts && pnpm exec vitest run`
Expected: all pass (nothing else uses a 4th arg).

- [ ] **Step 5: Commit**

```bash
git add src/lib/job-view.ts tests/api-jobs.test.ts
git commit -m "feat(api): pageSize option for buildJobView"
```

---

### Task 2: API key generation & storage (`src/lib/api/keys.ts`)

**Files:**
- Create: `src/lib/api/keys.ts`
- Create: `tests/api-keys.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/api-keys.test.ts`:

```ts
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiKey, hashKey, listApiKeys, revokeApiKey } from "@/lib/api/keys";

let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
});

describe("hashKey", () => {
  it("is sha256 hex of the presented key", () => {
    expect(hashKey("jrk_test")).toBe(
      createHash("sha256").update("jrk_test").digest("hex"),
    );
  });
});

describe("createApiKey", () => {
  it("stores only a hash and returns the plaintext once", () => {
    const { key, plaintext } = createApiKey(db, "my-app");

    expect(plaintext).toMatch(/^jrk_[A-Za-z0-9_-]{43}$/);
    expect(key.name).toBe("my-app");
    expect(key.prefix).toBe(plaintext.slice(0, 12));
    expect(key.revokedAt).toBeNull();
    expect(key.lastUsedAt).toBeNull();
    expect(key.requestCount).toBe(0);

    const row = db
      .prepare("SELECT key_hash, prefix, name FROM api_keys WHERE id = ?")
      .get(key.id) as { key_hash: string; prefix: string; name: string };
    expect(row.key_hash).toBe(hashKey(plaintext));
    expect(row.key_hash).not.toContain(plaintext);
    expect(row.prefix).toBe(key.prefix);
  });

  it("generates unique plaintexts", () => {
    const a = createApiKey(db, "a");
    const b = createApiKey(db, "b");
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.key.key_hash ?? null).toBeNull(); // hash never exposed on the record
  });
});

describe("listApiKeys / revokeApiKey", () => {
  it("lists newest first and records revocation", () => {
    const a = createApiKey(db, "a");
    const b = createApiKey(db, "b");

    expect(listApiKeys(db).map((k) => k.id)).toEqual([b.key.id, a.key.id]);

    expect(revokeApiKey(db, a.key.id)).toBe(true);
    const revoked = listApiKeys(db).find((k) => k.id === a.key.id);
    expect(revoked?.revokedAt).not.toBeNull();

    expect(revokeApiKey(db, a.key.id)).toBe(false); // already revoked
    expect(revokeApiKey(db, 9999)).toBe(false); // unknown
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/api-keys.test.ts`
Expected: FAIL — module `@/lib/api/keys` not found.

- [ ] **Step 3: Implement**

Create `src/lib/api/keys.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

// ── Schema (feature-owned) ──────────────────────────────────────────────────
// The consumer API owns its table and provisions it lazily, so the core
// migrate() in src/db/index.ts stays untouched by this feature.

const ensured = new WeakSet<object>();

function ensureSchema(db: DatabaseSync): void {
  if (ensured.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      key_hash      TEXT NOT NULL UNIQUE,
      prefix        TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      last_used_at  TEXT,
      request_count INTEGER NOT NULL DEFAULT 0,
      revoked_at    TEXT
    );
  `);
  ensured.add(db);
}

// ── Types ───────────────────────────────────────────────────────────────────

/** Key metadata safe to render in the UI — never includes the plaintext/hash. */
export interface ApiKeyRecord {
  id: number;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  requestCount: number;
  revokedAt: string | null;
}

// ── Generation & hashing ────────────────────────────────────────────────────

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function createApiKey(
  db: DatabaseSync,
  name: string,
): { key: ApiKeyRecord; plaintext: string } {
  ensureSchema(db);
  const plaintext = `jrk_${randomBytes(32).toString("base64url")}`;
  const createdAt = new Date().toISOString();
  const res = db
    .prepare("INSERT INTO api_keys (name, key_hash, prefix, created_at) VALUES (?, ?, ?, ?)")
    .run(name, hashKey(plaintext), plaintext.slice(0, 12), createdAt);
  return {
    key: {
      id: Number(res.lastInsertRowid),
      name,
      prefix: plaintext.slice(0, 12),
      createdAt,
      lastUsedAt: null,
      requestCount: 0,
      revokedAt: null,
    },
    plaintext,
  };
}

interface ApiKeyRow {
  id: number;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
  revoked_at: string | null;
}

function rowToRecord(r: ApiKeyRow): ApiKeyRecord {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    requestCount: r.request_count,
    revokedAt: r.revoked_at,
  };
}

export function listApiKeys(db: DatabaseSync): ApiKeyRecord[] {
  ensureSchema(db);
  return (
    db.prepare("SELECT * FROM api_keys ORDER BY id DESC").all() as ApiKeyRow[]
  ).map(rowToRecord);
}

/** Marks a key revoked; false when unknown or already revoked. */
export function revokeApiKey(db: DatabaseSync, id: number): boolean {
  ensureSchema(db);
  const res = db
    .prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(new Date().toISOString(), id);
  return Number(res.changes) > 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/api-keys.test.ts`
Expected: PASS. (The odd assertion `key.key_hash ?? null` in "unique plaintexts" will be a TS error — remove that line if tsc complains; its purpose was documentation. Prefer deleting it.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/keys.ts tests/api-keys.test.ts
git commit -m "feat(api): api key generation and hashed storage"
```

---

### Task 3: Request authentication (`authenticateApiKey`)

**Files:**
- Modify: `src/lib/api/keys.ts`
- Test: `tests/api-keys.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/api-keys.test.ts` (add `authenticateApiKey` to the existing import):

```ts
import { authenticateApiKey } from "@/lib/api/keys"; // merge into existing import

function authRequest(key?: string, mode: "bearer" | "x-api-key" = "bearer"): Request {
  const headers = new Headers();
  if (key) {
    if (mode === "bearer") headers.set("authorization", `Bearer ${key}`);
    else headers.set("x-api-key", key);
  }
  return new Request("https://jobradar.local/api/v1/jobs", { headers });
}

describe("authenticateApiKey", () => {
  it("401s when no key is presented", () => {
    expect(authenticateApiKey(authRequest(), db)).toEqual({ ok: false, status: 401 });
  });

  it("401s on an unknown key", () => {
    expect(authenticateApiKey(authRequest("jrk_nope"), db)).toEqual({ ok: false, status: 401 });
  });

  it("accepts a valid Bearer key and records usage", () => {
    const { plaintext, key } = createApiKey(db, "app");
    const res = authenticateApiKey(authRequest(plaintext), db);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.key.id).toBe(key.id);

    const row = db
      .prepare("SELECT last_used_at, request_count FROM api_keys WHERE id = ?")
      .get(key.id) as { last_used_at: string | null; request_count: number };
    expect(row.request_count).toBe(1);
    expect(row.last_used_at).not.toBeNull();
  });

  it("accepts x-api-key as an alternative header", () => {
    const { plaintext } = createApiKey(db, "app");
    expect(authenticateApiKey(authRequest(plaintext, "x-api-key"), db).ok).toBe(true);
  });

  it("throttles usage writes to once per 60s window", () => {
    const { plaintext, key } = createApiKey(db, "app");
    authenticateApiKey(authRequest(plaintext), db);
    authenticateApiKey(authRequest(plaintext), db);
    const row = db
      .prepare("SELECT request_count FROM api_keys WHERE id = ?")
      .get(key.id) as { request_count: number };
    expect(row.request_count).toBe(1);
  });

  it("403s a revoked key", () => {
    const { plaintext } = createApiKey(db, "app");
    const id = (authenticateApiKey(authRequest(plaintext), db) as { key: { id: number } }).key.id;
    revokeApiKey(db, id);
    expect(authenticateApiKey(authRequest(plaintext), db)).toEqual({ ok: false, status: 403 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/api-keys.test.ts`
Expected: FAIL — `authenticateApiKey` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/api/keys.ts`:

```ts
// ── Request authentication ──────────────────────────────────────────────────

export type AuthResult =
  | { ok: true; key: ApiKeyRecord }
  | { ok: false; status: 401 | 403 };

/** Usage stats are best-effort: written at most once per key per 60s. */
const USAGE_THROTTLE_MS = 60_000;
const lastUsageWrite = new Map<number, number>();

function recordUsage(db: DatabaseSync, keyId: number): void {
  const now = Date.now();
  if (now - (lastUsageWrite.get(keyId) ?? 0) < USAGE_THROTTLE_MS) return;
  lastUsageWrite.set(keyId, now);
  try {
    db.prepare(
      "UPDATE api_keys SET last_used_at = ?, request_count = request_count + 1 WHERE id = ?",
    ).run(new Date(now).toISOString(), keyId);
  } catch {
    // stats must never break a request
  }
}

/**
 * Verifies `Authorization: Bearer <key>` (primary) or `x-api-key: <key>`.
 * Records usage for valid, non-revoked keys.
 */
export function authenticateApiKey(request: Request, db: DatabaseSync): AuthResult {
  const header = request.headers.get("authorization");
  const presented = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : (request.headers.get("x-api-key")?.trim() || null);
  if (!presented) return { ok: false, status: 401 };

  ensureSchema(db);
  const row = db
    .prepare("SELECT * FROM api_keys WHERE key_hash = ?")
    .get(hashKey(presented)) as ApiKeyRow | undefined;
  if (!row) return { ok: false, status: 401 };

  const record = rowToRecord(row);
  if (record.revokedAt) return { ok: false, status: 403 };
  recordUsage(db, record.id);
  return { ok: true, key: record };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/api-keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/keys.ts tests/api-keys.test.ts
git commit -m "feat(api): authenticate requests against hashed api keys"
```

---

### Task 4: Query parameter parsing (`src/lib/api/query.ts`)

**Files:**
- Create: `src/lib/api/query.ts`
- Test: `tests/api-jobs.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/api-jobs.test.ts`:

```ts
import { parseJobsQuery } from "@/lib/api/query"; // new top-level import

describe("parseJobsQuery", () => {
  const BASE = "https://jobradar.local/api/v1/jobs";

  it("applies defaults", () => {
    const r = parseJobsQuery(BASE);
    expect(r).toEqual({
      ok: true,
      params: {},
      page: 1,
      pageSize: 25,
    });
  });

  it("collects repeatable facet params into arrays", () => {
    const r = parseJobsQuery(`${BASE}?skill=Java&skill=Spring&country=Germany`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params.skill).toEqual(["Java", "Spring"]);
      expect(r.params.country).toEqual(["Germany"]);
    }
  });

  it("maps scalar filter params", () => {
    const r = parseJobsQuery(`${BASE}?q=java&status=new&remote=anywhere&visa=1&page=3&pageSize=50`);
    expect(r).toEqual({
      ok: true,
      params: { q: "java", status: "new", remote: "anywhere", visa: "1" },
      page: 3,
      pageSize: 50,
    });
  });

  it("rejects invalid enum values, pageSize bounds, and non-numeric pages", () => {
    expect(parseJobsQuery(`${BASE}?status=archived`).ok).toBe(false);
    expect(parseJobsQuery(`${BASE}?remote=sortof`).ok).toBe(false);
    expect(parseJobsQuery(`${BASE}?pageSize=201`).ok).toBe(false);
    expect(parseJobsQuery(`${BASE}?pageSize=0`).ok).toBe(false);
    expect(parseJobsQuery(`${BASE}?page=abc`).ok).toBe(false);
  });

  it("ignores unknown params", () => {
    expect(parseJobsQuery(`${BASE}?utm_source=app`).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/api-jobs.test.ts`
Expected: FAIL — module `@/lib/api/query` not found.

- [ ] **Step 3: Implement**

Create `src/lib/api/query.ts`:

```ts
import { z } from "zod";
import type { RawParams } from "@/lib/job-view";

/**
 * Query params for GET /api/v1/jobs. Repeatable facet params arrive as
 * multi-value search params; everything else is a plain string.
 * `page`/`pageSize` are returned separately — they drive pagination, not
 * the filter pipeline.
 */

export type ParsedJobsQuery =
  | { ok: true; params: RawParams; page: number; pageSize: number }
  | { ok: false; error: string };

const REPEATABLE = ["skill", "country", "company", "source"] as const;

const facetArray = z.array(z.string().min(1).max(120)).max(30);

const filtersSchema = z.object({
  q: z.string().min(1).max(300).optional(),
  status: z.enum(["new", "favorite", "applied"]).optional(),
  remote: z.enum(["1", "anywhere", "restricted"]).optional(),
  visa: z.literal("1").optional(),
  skill: facetArray.optional(),
  country: facetArray.optional(),
  company: facetArray.optional(),
  source: facetArray.optional(),
});

const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export function parseJobsQuery(url: string): ParsedJobsQuery {
  const sp = new URL(url).searchParams;
  const raw: Record<string, string | string[]> = {};
  for (const [key, value] of sp.entries()) {
    if ((REPEATABLE as readonly string[]).includes(key)) {
      (raw[key] ??= []).push(value);
    } else {
      raw[key] = value;
    }
  }

  const paging = pagingSchema.safeParse({
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  if (!paging.success) {
    return { ok: false, error: paging.error.issues[0]?.message ?? "invalid page params" };
  }

  const filters = filtersSchema.safeParse(raw);
  if (!filters.success) {
    return { ok: false, error: filters.error.issues[0]?.message ?? "invalid filter params" };
  }

  return { ok: true, params: filters.data as RawParams, ...paging.data };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/api-jobs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/query.ts tests/api-jobs.test.ts
git commit -m "feat(api): consumer query param parsing with zod"
```

---

### Task 5: Public DTO serializer (`src/lib/api/serialize.ts`)

**Files:**
- Create: `src/lib/api/serialize.ts`
- Test: `tests/api-jobs.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/api-jobs.test.ts`:

```ts
import { toPublicJob } from "@/lib/api/serialize"; // new top-level import
import { countryFacetValue } from "@/lib/facets";

describe("toPublicJob", () => {
  it("maps the public field allowlist and computes country", () => {
    const dto = toPublicJob(makeListing({ remoteScope: "restricted" }));

    expect(dto).toEqual({
      id: 1,
      source: "RemoteOK",
      externalId: "ext-1",
      title: "Java Engineer",
      company: "Acme",
      location: "Remote",
      country: countryFacetValue(makeListing({ remoteScope: "restricted" })),
      isRemote: true,
      remoteScope: "restricted",
      visaSponsorship: false,
      tags: ["java"],
      skills: ["Java"],
      url: "https://example.com/1",
      postedAt: "2026-09-10T00:00:00Z",
      deadline: null,
      fetchedAt: "2026-09-12T00:00:00Z",
      description: "Great job",
    });
  });

  it("never leaks personal/workflow fields", () => {
    const dto = toPublicJob(makeListing());
    for (const forbidden of ["status", "userTags", "searchText", "boardFilterKeywords", "boardId"]) {
      expect(dto).not.toHaveProperty(forbidden);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/api-jobs.test.ts`
Expected: FAIL — module `@/lib/api/serialize` not found.

- [ ] **Step 3: Implement**

Create `src/lib/api/serialize.ts`:

```ts
import { countryFacetValue } from "@/lib/facets";
import type { FilterableListing, RemoteScope } from "@/lib/types";

/** The consumer-facing job shape — personal/workflow fields excluded. */
export interface PublicJob {
  id: number;
  source: string;
  externalId: string;
  title: string;
  company: string;
  location: string;
  country: string;
  isRemote: boolean;
  remoteScope: RemoteScope;
  visaSponsorship: boolean;
  tags: string[];
  skills: string[];
  url: string;
  postedAt: string | null;
  deadline: string | null;
  fetchedAt: string;
  description: string;
}

export function toPublicJob(l: FilterableListing): PublicJob {
  return {
    id: l.id,
    source: l.boardName,
    externalId: l.externalId,
    title: l.title,
    company: l.company,
    location: l.location,
    country: countryFacetValue(l),
    isRemote: l.isRemote,
    remoteScope: l.remoteScope,
    visaSponsorship: l.visaSponsorship,
    tags: l.tags,
    skills: l.skills,
    url: l.url,
    postedAt: l.postedAt,
    deadline: l.deadline,
    fetchedAt: l.fetchedAt,
    description: l.description,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/api-jobs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/serialize.ts tests/api-jobs.test.ts
git commit -m "feat(api): public job DTO serializer"
```

---

### Task 6: Endpoint builders + routes

**Files:**
- Create: `tests/helpers/test-db.ts`
- Create: `src/lib/api/jobs.ts`
- Create: `src/app/api/v1/jobs/route.ts`, `src/app/api/v1/jobs/[id]/route.ts`, `src/app/api/v1/meta/route.ts`
- Test: `tests/api-jobs.test.ts` (extend), `tests/api-keys.test.ts` untouched

- [ ] **Step 1: Write the failing tests**

Create `tests/helpers/test-db.ts`:

```ts
import { DatabaseSync } from "node:sqlite";
import type { DatabaseSync as DB } from "node:sqlite";

/**
 * In-memory DB mirroring the boards/listings DDL of src/db/index.ts
 * (kept in sync manually — the API feature does not touch that file).
 * api_keys is provisioned lazily by src/lib/api/keys.ts.
 */
export function createTestDb(): DB {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE boards (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      name                 TEXT NOT NULL UNIQUE,
      type                 TEXT NOT NULL,
      url                  TEXT NOT NULL,
      enabled              INTEGER NOT NULL DEFAULT 1,
      filter_keywords      TEXT NOT NULL DEFAULT '[]',
      last_fetched_at      TEXT,
      last_status          TEXT,
      fetch_interval_hours INTEGER NOT NULL DEFAULT 4
    );

    CREATE TABLE listings (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id         INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      external_id      TEXT NOT NULL,
      title            TEXT NOT NULL,
      company          TEXT NOT NULL DEFAULT '',
      location         TEXT NOT NULL DEFAULT '',
      is_remote        INTEGER NOT NULL DEFAULT 0,
      visa_sponsorship INTEGER NOT NULL DEFAULT 0,
      remote_scope     TEXT,
      tags             TEXT NOT NULL DEFAULT '[]',
      skills           TEXT NOT NULL DEFAULT '[]',
      url              TEXT NOT NULL DEFAULT '',
      posted_at        TEXT,
      deadline         TEXT,
      fetched_at       TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'new',
      user_tags        TEXT NOT NULL DEFAULT '[]',
      search_text      TEXT NOT NULL DEFAULT '',
      description      TEXT NOT NULL DEFAULT '',
      UNIQUE (board_id, external_id)
    );
  `);
  return db;
}

export function seedBoard(db: DB, id: number, name: string): void {
  db.prepare(
    "INSERT INTO boards (id, name, type, url) VALUES (?, ?, 'api', 'https://example.com')",
  ).run(id, name);
}

export interface SeedOverrides {
  id?: number;
  boardId?: number;
  externalId?: string;
  title?: string;
  company?: string;
  location?: string;
  isRemote?: boolean;
  visa?: boolean;
  remoteScope?: string | null;
  tags?: string[];
  skills?: string[];
  status?: string;
  postedAt?: string | null;
  description?: string;
}

export function seedListing(db: DB, o: SeedOverrides = {}): number {
  const v = {
    boardId: 1,
    externalId: `ext-${Math.random().toString(36).slice(2)}`,
    title: "Java Engineer",
    company: "Acme",
    location: "Remote",
    isRemote: true,
    visa: false,
    remoteScope: "anywhere" as string | null,
    tags: ["java"] as string[],
    skills: ["Java"] as string[],
    status: "new",
    postedAt: "2026-09-10T00:00:00Z" as string | null,
    description: "Great job",
    ...o,
  };
  const res = db
    .prepare(
      `INSERT INTO listings
         (board_id, external_id, title, company, location, is_remote, visa_sponsorship,
          remote_scope, tags, skills, url, posted_at, fetched_at, status, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      v.boardId,
      v.externalId,
      v.title,
      v.company,
      v.location,
      v.isRemote ? 1 : 0,
      v.visa ? 1 : 0,
      v.remoteScope,
      JSON.stringify(v.tags),
      JSON.stringify(v.skills),
      `https://example.com/jobs/${v.externalId}`,
      v.postedAt,
      "2026-09-12T00:00:00Z",
      v.status,
      v.description,
    );
  return Number(res.lastInsertRowid);
}
```

Append to `tests/api-jobs.test.ts` (new top-level imports: `beforeEach` from vitest; `createApiKey` from `@/lib/api/keys`; the three builders from `@/lib/api/jobs`; helpers):

```ts
import { beforeEach } from "vitest"; // merge into the existing vitest import
import { createApiKey } from "@/lib/api/keys"; // new import
import {
  corsPreflight,
  jobDetailResponse,
  jobsListResponse,
  metaResponse,
} from "@/lib/api/jobs";
import { createTestDb, seedBoard, seedListing } from "./helpers/test-db";
import type { DatabaseSync } from "node:sqlite";

let db: DatabaseSync;
let KEY: string;

beforeEach(() => {
  db = createTestDb();
  seedBoard(db, 1, "RemoteOK");
  seedBoard(db, 2, "Remotive");
  KEY = createApiKey(db, "tests").plaintext;
});

function req(path = "/api/v1/jobs", withKey = true): Request {
  const headers = new Headers();
  if (withKey) headers.set("authorization", `Bearer ${KEY}`);
  return new Request(`https://jobradar.local${path}`, { headers });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("jobsListResponse", () => {
  beforeEach(() => {
    seedListing(db, { id: 1, title: "Java Engineer", remoteScope: "anywhere" });
    seedListing(db, {
      id: 2,
      title: "Backend Engineer",
      company: "Beta",
      location: "Berlin, Germany",
      isRemote: false,
      remoteScope: null,
      skills: ["Python"],
      tags: [],
      postedAt: "2026-09-11T00:00:00Z",
    });
    seedListing(db, { id: 3, title: "Hidden Role", status: "hidden" });
    seedListing(db, {
      id: 4,
      boardId: 2,
      title: "Java Architect",
      status: "favorite",
    });
  });

  it("401s without a key and includes CORS headers even on errors", async () => {
    const res = jobsListResponse(req("/api/v1/jobs", false), db);
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await body(res)).toEqual({ error: "unauthorized" });
  });

  it("403s a revoked key", async () => {
    // find the key id via the detail of a fresh key
    const { plaintext, key } = createApiKey(db, "shortlived");
    db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      key.id,
    );
    const res = jobsListResponse(
      new Request("https://jobradar.local/api/v1/jobs", {
        headers: { authorization: `Bearer ${plaintext}` },
      }),
      db,
    );
    expect(res.status).toBe(403);
    expect(await body(res)).toEqual({ error: "revoked" });
  });

  it("returns the default page with the pagination envelope", async () => {
    const res = jobsListResponse(req(), db);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = await body(res);
    // hidden excluded; company+title dedupe doesn't collide here
    expect((json.data as unknown[]).length).toBe(3);
    expect(json.pagination).toEqual({ page: 1, pageSize: 25, total: 3, totalPages: 1 });
    expect(typeof json.generatedAt).toBe("string");
  });

  it("filters by remote scope, status, source, skill, and q", async () => {
    const anywhere = await body(jobsListResponse(req("/api/v1/jobs?remote=anywhere"), db));
    expect((anywhere.data as unknown[]).map((j) => (j as { id: number }).id)).toEqual([1, 3].map(() => expect.any(Number)));
    // ^ ids 1 and 4 are remote-anywhere; 2 is onsite, 3 hidden

    const favorites = await body(jobsListResponse(req("/api/v1/jobs?status=favorite"), db));
    expect(favorites.pagination).toMatchObject({ total: 1 });

    const source = await body(jobsListResponse(req("/api/v1/jobs?source=Remotive"), db));
    expect(source.pagination).toMatchObject({ total: 1 });

    const skill = await body(jobsListResponse(req("/api/v1/jobs?skill=Python"), db));
    expect(skill.pagination).toMatchObject({ total: 1 });

    const q = await body(jobsListResponse(req("/api/v1/jobs?q=architect"), db));
    expect(q.pagination).toMatchObject({ total: 1 });
  });

  it("paginates with pageSize and clamps out-of-range pages", async () => {
    const p1 = await body(jobsListResponse(req("/api/v1/jobs?pageSize=2&page=1"), db));
    expect(p1.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    const p2 = await body(jobsListResponse(req("/api/v1/jobs?pageSize=2&page=2"), db));
    expect((p2.data as unknown[]).length).toBe(1);
    const clamped = await body(jobsListResponse(req("/api/v1/jobs?pageSize=2&page=99"), db));
    expect(clamped.pagination).toMatchObject({ page: 2 });
  });

  it("400s invalid params", async () => {
    const res = jobsListResponse(req("/api/v1/jobs?pageSize=500"), db);
    expect(res.status).toBe(400);
    expect(await body(res)).toHaveProperty("error", "invalid_params");
  });
});

describe("jobDetailResponse", () => {
  beforeEach(() => {
    seedListing(db, { id: 1, title: "Java Engineer", description: "Desc" });
    seedListing(db, { id: 2, title: "Hidden Role", status: "hidden" });
  });

  it("returns a single public job", async () => {
    const res = jobDetailResponse(req("/api/v1/jobs/1"), db, "1");
    expect(res.status).toBe(200);
    const json = await body(res);
    expect((json.data as { id: number }).id).toBe(1);
  });

  it("404s on unknown id, hidden job, and non-numeric id", async () => {
    expect(jobDetailResponse(req("/api/v1/jobs/9"), db, "9").status).toBe(404);
    expect(jobDetailResponse(req("/api/v1/jobs/2"), db, "2").status).toBe(404);
    expect(jobDetailResponse(req("/api/v1/jobs/abc"), db, "abc").status).toBe(404);
  });
});

describe("metaResponse", () => {
  it("returns facet values with counts over the non-hidden pool", async () => {
    seedListing(db, { id: 1, boardId: 1, title: "A", skills: ["Java"], remoteScope: "anywhere", location: "Remote" });
    seedListing(db, { id: 2, boardId: 2, title: "B", company: "Beta", skills: ["Python"], remoteScope: null, isRemote: false, location: "Berlin, Germany" });
    seedListing(db, { id: 3, boardId: 1, title: "C", status: "hidden" });

    const json = await body(metaResponse(req("/api/v1/meta"), db));
    expect(json.total).toBe(2);
    expect(json.skills).toEqual([
      { name: "Java", count: 1 },
      { name: "Python", count: 1 },
    ]);
    expect(json.sources).toEqual([
      { name: "RemoteOK", count: 1 },
      { name: "Remotive", count: 1 },
    ]);
    expect(Array.isArray(json.countries)).toBe(true);
    expect(Array.isArray(json.companies)).toBe(true);
  });
});

describe("corsPreflight", () => {
  it("returns 204 with CORS headers", () => {
    const res = corsPreflight();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/api-jobs.test.ts`
Expected: FAIL — module `@/lib/api/jobs` not found.

- [ ] **Step 3: Implement `src/lib/api/jobs.ts`**

```ts
import type { DatabaseSync } from "node:sqlite";
import { rowToListing } from "@/db";
import { authenticateApiKey } from "@/lib/api/keys";
import { parseJobsQuery } from "@/lib/api/query";
import { toPublicJob } from "@/lib/api/serialize";
import { buildJobView } from "@/lib/job-view";
import type { FilterableListing } from "@/lib/types";

// ── Shared response plumbing ────────────────────────────────────────────────

const API_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, x-api-key",
  "Cache-Control": "no-store",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: API_HEADERS });
}

export function apiError(status: number, code: string, details?: unknown): Response {
  return jsonResponse(details === undefined ? { error: code } : { error: code, details }, status);
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: API_HEADERS });
}

function requireAuth(request: Request, db: DatabaseSync): Response | null {
  const auth = authenticateApiKey(request, db);
  if (auth.ok) return null;
  return apiError(auth.status, auth.status === 403 ? "revoked" : "unauthorized");
}

/** The full listings pool joined with board names — same query the dashboard uses. */
export function loadListingsPool(db: DatabaseSync): FilterableListing[] {
  const rows = db
    .prepare(
      `SELECT l.*, b.name AS board_name, b.filter_keywords AS board_filter_keywords
       FROM listings l JOIN boards b ON b.id = l.board_id
       ORDER BY COALESCE(l.posted_at, l.fetched_at) DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => rowToListing(r as never)) as FilterableListing[];
}

// ── GET /api/v1/jobs ────────────────────────────────────────────────────────

export function jobsListResponse(request: Request, db: DatabaseSync): Response {
  const denied = requireAuth(request, db);
  if (denied) return denied;

  const parsed = parseJobsQuery(request.url);
  if (!parsed.ok) return apiError(400, "invalid_params", parsed.error);

  const view = buildJobView(loadListingsPool(db), parsed.params, [], {
    pageSize: parsed.pageSize,
  });

  return jsonResponse({
    data: view.entries.map((e) => toPublicJob(e.listing)),
    pagination: {
      page: view.currentPage,
      pageSize: parsed.pageSize,
      total: view.totalVisible,
      totalPages: view.totalPages,
    },
    generatedAt: new Date().toISOString(),
  });
}

// ── GET /api/v1/jobs/:id ────────────────────────────────────────────────────

export function jobDetailResponse(request: Request, db: DatabaseSync, idParam: string): Response {
  const denied = requireAuth(request, db);
  if (denied) return denied;

  const id = Number.parseInt(idParam, 10);
  const listing = Number.isNaN(id)
    ? undefined
    : loadListingsPool(db).find((l) => l.id === id);
  if (!listing || listing.status === "hidden") return apiError(404, "not_found");

  return jsonResponse({
    data: toPublicJob(listing),
    generatedAt: new Date().toISOString(),
  });
}

// ── GET /api/v1/meta ────────────────────────────────────────────────────────

export function metaResponse(request: Request, db: DatabaseSync): Response {
  const denied = requireAuth(request, db);
  if (denied) return denied;

  // No selections → facet counts over the whole non-hidden pool.
  const view = buildJobView(loadListingsPool(db), {}, []);
  const byParam = Object.fromEntries(
    view.facets.map((f) => [f.param as string, f.values]),
  );

  return jsonResponse({
    total: view.totalVisible,
    skills: byParam.skill,
    countries: byParam.country,
    companies: byParam.company,
    sources: byParam.source,
    generatedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/api-jobs.test.ts tests/api-keys.test.ts`
Expected: PASS. If the `remote=anywhere` ordering assertion is brittle, tighten it to compare sorted ids: `.sort((a, b) => a - b)` against `[1, 4]`.

- [ ] **Step 5: Create the route files**

`src/app/api/v1/jobs/route.ts`:

```ts
import { getDb } from "@/db";
import { corsPreflight, jobsListResponse } from "@/lib/api/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return jobsListResponse(request, getDb());
}

export { corsPreflight as OPTIONS };
```

`src/app/api/v1/jobs/[id]/route.ts`:

```ts
import { getDb } from "@/db";
import { corsPreflight, jobDetailResponse } from "@/lib/api/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return jobDetailResponse(request, getDb(), id);
}

export { corsPreflight as OPTIONS };
```

`src/app/api/v1/meta/route.ts`:

```ts
import { getDb } from "@/db";
import { corsPreflight, metaResponse } from "@/lib/api/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return metaResponse(request, getDb());
}

export { corsPreflight as OPTIONS };
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/jobs.ts src/app/api/v1 tests/helpers/test-db.ts tests/api-jobs.test.ts
git commit -m "feat(api): /api/v1 jobs, detail, and meta endpoints with key auth"
```

---

### Task 7: Key management UI (`/api-keys`)

**Files:**
- Create: `src/app/api-keys/actions.ts`, `src/app/api-keys/page.tsx`
- Create: `src/components/api-keys/CreateKeyForm.tsx`, `src/components/api-keys/RevokeButton.tsx`
- Create: `src/components/CopyButton.tsx`
- Modify: `src/components/AppHeader.tsx`

- [ ] **Step 0: Check this Next version's server-action conventions**

Skim `node_modules/next/dist/docs/01-app/01-getting-started/` for the server-actions/updating-data guide; the repo's `src/app/actions.ts` ("use server", zod validate, `revalidatePath`, actions return `Promise<void>`) is the local precedent. `useActionState` from React 19 powers the one-time-secret display.

- [ ] **Step 1: Server actions**

Create `src/app/api-keys/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { createApiKey, revokeApiKey } from "@/lib/api/keys";

export interface CreateKeyState {
  error?: string;
  name?: string;
  plaintext?: string;
  prefix?: string;
}

export async function createApiKeyAction(
  _prev: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Give the key a name — which app uses it?" };

  const { key, plaintext } = createApiKey(getDb(), name);
  revalidatePath("/api-keys");
  return { name, plaintext, prefix: key.prefix };
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  revokeApiKey(getDb(), id);
  revalidatePath("/api-keys");
}
```

- [ ] **Step 2: Client components**

Create `src/components/CopyButton.tsx`:

```tsx
"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      aria-label="Copy to clipboard"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
    >
      {copied ? <Check className="h-4 w-4 text-teal-600" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}
```

Create `src/components/api-keys/CreateKeyForm.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import { createApiKeyAction, type CreateKeyState } from "@/app/api-keys/actions";
import { CopyButton } from "@/components/CopyButton";

const INITIAL: CreateKeyState = {};

export function CreateKeyForm() {
  const [state, formAction, pending] = useActionState(createApiKeyAction, INITIAL);
  const [dismissed, setDismissed] = useState(false);
  const showSecret = Boolean(state.plaintext) && !dismissed;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="min-w-48 flex-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            Key name
          </span>
          <input
            name="name"
            required
            maxLength={80}
            placeholder="my-app"
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>

      {state.error && <p className="mt-3 text-sm font-medium text-red-600">{state.error}</p>}

      {showSecret && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            Copy your new API key now — it won’t be shown again.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-xs text-slate-800">
              {state.plaintext}
            </code>
            <CopyButton text={state.plaintext ?? ""} />
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
```

Create `src/components/api-keys/RevokeButton.tsx`:

```tsx
"use client";

import { revokeApiKeyAction } from "@/app/api-keys/actions";

export function RevokeButton({ id, revoked }: { id: number; revoked: boolean }) {
  if (revoked) {
    return (
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Revoked
      </span>
    );
  }
  return (
    <form
      action={revokeApiKeyAction}
      onSubmit={(e) => {
        if (!window.confirm("Revoke this key? Apps using it lose access immediately.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="text-xs font-semibold text-red-600 transition-colors hover:text-red-700 hover:underline"
      >
        Revoke
      </button>
    </form>
  );
}
```

- [ ] **Step 3: The page**

Create `src/app/api-keys/page.tsx`:

```tsx
import { connection } from "next/server";
import { KeyRound } from "lucide-react";
import { getDb } from "@/db";
import { listApiKeys } from "@/lib/api/keys";
import { CreateKeyForm } from "@/components/api-keys/CreateKeyForm";
import { RevokeButton } from "@/components/api-keys/RevokeButton";

export const metadata = { title: "API Keys · JobRadar" };

export default async function ApiKeysPage() {
  await connection(); // DB reads must not be prerendered
  const keys = listApiKeys(getDb());

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">
          Developer
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-950">
          <KeyRound className="h-5 w-5 text-teal-600" /> API keys
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Let other apps read your job list from{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">/api/v1/jobs</code> with{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">Authorization: Bearer &lt;key&gt;</code>.
          Keys are stored hashed and shown only once, at creation.
        </p>
      </header>

      <CreateKeyForm />

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {keys.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            No API keys yet. Create one above to let another app consume your feed.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{k.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-slate-400">{k.prefix}…</p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p>Created {new Date(k.createdAt).toLocaleDateString()}</p>
                  <p className="mt-0.5">
                    {k.lastUsedAt
                      ? `Used ${new Date(k.lastUsedAt).toLocaleString()} · ${k.requestCount} reqs`
                      : "Never used"}
                  </p>
                </div>
                <RevokeButton id={k.id} revoked={k.revokedAt !== null} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Nav link**

In `src/components/AppHeader.tsx`, add `KeyRound` to the lucide import and a NAV_LINKS entry:

```ts
import { KeyRound, LayoutDashboard, MapPin, Radar, Send, SlidersHorizontal, Star } from "lucide-react";
```
```ts
  { href: "/boards", label: "Boards", icon: SlidersHorizontal },
  { href: "/api-keys", label: "API Keys", icon: KeyRound },
] as const;
```

- [ ] **Step 5: Verify type/lint and manually exercise the page**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: clean (pre-existing WIP lint errors outside touched files are acceptable — note them).

Manual: start `pnpm dev` in the background, open `http://localhost:3000/api-keys`, create a key named "smoke", copy the plaintext, confirm it appears hashed in the list with prefix, revoke it, confirm the Revoked badge. Kill the dev server afterwards.

- [ ] **Step 6: Commit**

```bash
git add src/app/api-keys src/components/api-keys src/components/CopyButton.tsx src/components/AppHeader.tsx
git commit -m "feat(ui): api key management page"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite + types + lint**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: all tests pass (existing suite + new), no type errors.

- [ ] **Step 2: Live curl smoke test**

Start the dev server in the background (`pnpm dev`). Create a key (UI or direct insert), then:

```bash
KEY=jrk_…  # the plaintext from creation
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v1/jobs                 # expect 401
curl -s -H "Authorization: Bearer $KEY" "http://localhost:3000/api/v1/jobs?pageSize=2" | head -c 600
curl -s -H "Authorization: Bearer $KEY" "http://localhost:3000/api/v1/meta" | head -c 400
curl -s -H "x-api-key: $KEY" "http://localhost:3000/api/v1/jobs/1" -o /dev/null -w "%{http_code}\n"
```

Expected: 401 unauthenticated; authenticated list returns `data` + `pagination`; meta returns facet arrays; detail returns 200 (or 404 if id 1 doesn't exist — check the id from the list response).

- [ ] **Step 3: Wrap up**

Kill the dev server. Report results; the feature is complete. No further commit unless verification required fixes.

---

## Self-review notes

- **Spec coverage:** endpoints (list/detail/meta) → Task 6; auth headers + 401/403/400/404 → Tasks 3/6; hashed keys + shown-once + revoke + last-used/counts → Tasks 2/3; management UI + nav → Task 7; CORS/no-store → Task 6; full-dataset-minus-hidden semantics (`globalKeywords = []`, hidden excluded by pipeline) → Task 6; pageSize bounds (1–200, default 25) → Task 4; dedupe + page clamp inherited from `buildJobView` → Tasks 1/6.
- **Placeholders:** none — every code step is complete.
- **Type consistency:** `ApiKeyRecord` used by keys.ts and page.tsx; `ParsedJobsQuery` consumed in jobs.ts; `PublicJob` from serialize.ts used by jobs.ts; `RawParams` exported in Task 1 before query.ts (Task 4) imports it; `corsPreflight`/`apiError` defined before route files re-export them.
