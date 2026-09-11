import { describe, expect, it } from "vitest";
import { buildJobView, PAGE_SIZE } from "@/lib/job-view";
import { parseJobsQuery } from "@/lib/api/query";
import { toPublicJob } from "@/lib/api/serialize";
import { countryFacetValue } from "@/lib/facets";
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

describe("parseJobsQuery", () => {
  const BASE = "https://jobradar.local/api/v1/jobs";

  it("applies defaults", () => {
    expect(parseJobsQuery(BASE)).toEqual({
      ok: true,
      params: { page: "1" }, // page flows through params so buildJobView clamps it
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
    expect(
      parseJobsQuery(`${BASE}?q=java&status=new&remote=anywhere&visa=1&page=3&pageSize=50`),
    ).toEqual({
      ok: true,
      params: { q: "java", status: "new", remote: "anywhere", visa: "1", page: "3" },
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

describe("toPublicJob", () => {
  it("maps the public field allowlist and computes country", () => {
    const source = makeListing({ remoteScope: "restricted" });
    const dto = toPublicJob(source);

    expect(dto).toEqual({
      id: 1,
      source: "RemoteOK",
      externalId: "ext-1",
      title: "Java Engineer",
      company: "Acme",
      location: "Remote",
      country: countryFacetValue(source),
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


// ── Endpoint builders ───────────────────────────────────────────────────────

import { beforeEach } from "vitest";
import {
  createApiKey,
  InMemoryKeyStore,
  type KeyStore,
} from "@/lib/api/keys";
import {
  corsPreflight,
  jobDetailResponse,
  jobsListResponse,
  metaResponse,
} from "@/lib/api/jobs";

let store: KeyStore;
let KEY: string;

beforeEach(async () => {
  store = new InMemoryKeyStore();
  KEY = (await createApiKey(store, "tests")).plaintext;
});

function req(path = "/api/v1/jobs", withKey = true): Request {
  const headers = new Headers();
  if (withKey) headers.set("authorization", `Bearer ${KEY}`);
  return new Request(`https://jobradar.local${path}`, { headers });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function dataIds(json: Record<string, unknown>): number[] {
  return (json.data as Array<{ id: number }>).map((j) => j.id).sort((a, b) => a - b);
}

/** Pool mirroring the old seeded DB: ids 1–4, id 3 hidden, id 4 on Remotive. */
function basePool(): FilterableListing[] {
  return [
    makeListing({ id: 1, title: "Java Engineer", remoteScope: "anywhere" }),
    makeListing({
      id: 2,
      title: "Backend Engineer",
      company: "Beta",
      location: "Berlin, Germany",
      isRemote: false,
      remoteScope: null,
      skills: ["Python"],
      tags: [],
      postedAt: "2026-09-11T00:00:00Z",
    }),
    makeListing({ id: 3, title: "Hidden Role", status: "hidden" }),
    makeListing({ id: 4, boardName: "Remotive", title: "Java Architect", status: "favorite" }),
  ];
}

describe("jobsListResponse", () => {
  it("401s without a key and includes CORS headers even on errors", async () => {
    const res = await jobsListResponse(req("/api/v1/jobs", false), store, basePool());
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await body(res)).toEqual({ error: "unauthorized" });
  });

  it("403s a revoked key", async () => {
    const { plaintext, key } = await createApiKey(store, "shortlived");
    await store.revoke(key.id, new Date().toISOString());
    const res = await jobsListResponse(
      new Request("https://jobradar.local/api/v1/jobs", {
        headers: { authorization: `Bearer ${plaintext}` },
      }),
      store,
      basePool(),
    );
    expect(res.status).toBe(403);
    expect(await body(res)).toEqual({ error: "revoked" });
  });

  it("returns the default page with the pagination envelope", async () => {
    const res = await jobsListResponse(req(), store, basePool());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = await body(res);
    // hidden excluded (id 3); company+title dedupe doesn't collide here
    expect(dataIds(json)).toEqual([1, 2, 4]);
    expect(json.pagination).toEqual({ page: 1, pageSize: 25, total: 3, totalPages: 1 });
    expect(typeof json.generatedAt).toBe("string");
  });

  it("filters by remote scope, status, source, skill, and q", async () => {
    const anywhere = await body(await jobsListResponse(req("/api/v1/jobs?remote=anywhere"), store, basePool()));
    expect(dataIds(anywhere)).toEqual([1, 4]); // 2 is onsite, 3 hidden

    const favorites = await body(await jobsListResponse(req("/api/v1/jobs?status=favorite"), store, basePool()));
    expect(favorites.pagination).toMatchObject({ total: 1 });

    const source = await body(await jobsListResponse(req("/api/v1/jobs?source=Remotive"), store, basePool()));
    expect(source.pagination).toMatchObject({ total: 1 });

    const skill = await body(await jobsListResponse(req("/api/v1/jobs?skill=Python"), store, basePool()));
    expect(skill.pagination).toMatchObject({ total: 1 });

    const q = await body(await jobsListResponse(req("/api/v1/jobs?q=architect"), store, basePool()));
    expect(q.pagination).toMatchObject({ total: 1 });
  });

  it("paginates with pageSize and clamps out-of-range pages", async () => {
    const p1 = await body(await jobsListResponse(req("/api/v1/jobs?pageSize=2&page=1"), store, basePool()));
    expect(p1.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    const p2 = await body(await jobsListResponse(req("/api/v1/jobs?pageSize=2&page=2"), store, basePool()));
    expect((p2.data as unknown[]).length).toBe(1);
    const clamped = await body(await jobsListResponse(req("/api/v1/jobs?pageSize=2&page=99"), store, basePool()));
    expect(clamped.pagination).toMatchObject({ page: 2 });
  });

  it("400s invalid params", async () => {
    const res = await jobsListResponse(req("/api/v1/jobs?pageSize=500"), store, basePool());
    expect(res.status).toBe(400);
    expect(await body(res)).toHaveProperty("error", "invalid_params");
  });
});

describe("jobDetailResponse", () => {
  const detailPool = (): FilterableListing[] => [
    makeListing({ id: 1, title: "Java Engineer", description: "Desc" }),
    makeListing({ id: 2, title: "Hidden Role", status: "hidden" }),
  ];

  it("returns a single public job", async () => {
    const res = await jobDetailResponse(req("/api/v1/jobs/1"), store, "1", detailPool());
    expect(res.status).toBe(200);
    const json = await body(res);
    expect((json.data as { id: number }).id).toBe(1);
  });

  it("404s on unknown id, hidden job, and non-numeric id", async () => {
    expect((await jobDetailResponse(req("/api/v1/jobs/9"), store, "9", detailPool())).status).toBe(404);
    expect((await jobDetailResponse(req("/api/v1/jobs/2"), store, "2", detailPool())).status).toBe(404);
    expect((await jobDetailResponse(req("/api/v1/jobs/abc"), store, "abc", detailPool())).status).toBe(404);
  });
});

describe("metaResponse", () => {
  it("returns facet values with counts over the non-hidden pool", async () => {
    const pool: FilterableListing[] = [
      makeListing({ id: 1, title: "A", skills: ["Java"], remoteScope: "anywhere", location: "Remote" }),
      makeListing({ id: 2, boardName: "Remotive", title: "B", company: "Beta", skills: ["Python"], remoteScope: null, isRemote: false, location: "Berlin, Germany" }),
      makeListing({ id: 3, title: "C", status: "hidden" }),
    ];

    const json = await body(await metaResponse(req("/api/v1/meta"), store, pool));
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
