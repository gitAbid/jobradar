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
