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
    expect(parseJobsQuery(BASE)).toEqual({ ok: true, params: {}, page: 1, pageSize: 25 });
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
