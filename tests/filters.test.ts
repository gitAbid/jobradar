import { describe, expect, it } from "vitest";
import {
  buildSearchText,
  matchedKeywords,
  matchesKeywords,
} from "@/lib/filters";

const base = {
  title: "Senior Java Backend Engineer",
  company: "Acme Corp",
  location: "Remote",
  tags: ["spring boot", "kafka"],
};

function makeListing(overrides: Partial<typeof base> = {}) {
  const merged = { ...base, ...overrides };
  return {
    ...merged,
    searchText: buildSearchText({
      title: merged.title,
      company: merged.company,
      location: merged.location,
      tags: merged.tags,
      description: "We need 8+ years of experience. Visa sponsorship available.",
    }),
    boardFilterKeywords: [] as string[],
  };
}

describe("buildSearchText", () => {
  it("lowercases and strips HTML from the description", () => {
    const text = buildSearchText({
      title: "Java Lead",
      company: "",
      location: "",
      tags: [],
      description: "<p>Strong <b>Spring Boot</b> &amp; Kafka skills</p>",
    });
    expect(text).toContain("java lead");
    expect(text).toContain("spring boot");
    expect(text).not.toContain("<p>");
    expect(text).not.toContain("&amp;");
  });

  it("truncates very long descriptions", () => {
    const text = buildSearchText({
      title: "t",
      company: "",
      location: "",
      tags: [],
      description: "x".repeat(5000),
    });
    expect(text.length).toBeLessThan(2200);
  });
});

describe("matchesKeywords", () => {
  it("matches when any global keyword hits the title", () => {
    expect(matchesKeywords(makeListing(), ["java"])).toBe(true);
  });

  it("matches multi-word keywords in tags", () => {
    expect(matchesKeywords(makeListing(), ["spring boot"])).toBe(true);
  });

  it("does not match unrelated keywords", () => {
    expect(matchesKeywords(makeListing(), ["python", "golang"])).toBe(false);
  });

  it("matches board-specific keywords too", () => {
    const l = { ...makeListing({ title: "Backend Engineer" }), boardFilterKeywords: ["kafka"] };
    expect(matchesKeywords(l, [])).toBe(true);
  });

  it("ignores keyword hits that appear only in the description", () => {
    // description says "Visa sponsorship available" but title/tags say nothing
    expect(matchesKeywords(makeListing({ title: "Account Executive" }), ["visa sponsorship"])).toBe(false);
  });

  it("everything matches when there are no keywords", () => {
    expect(matchesKeywords(makeListing(), [])).toBe(true);
  });
});

describe("matchedKeywords", () => {
  it("returns only the keywords actually present", () => {
    const matched = matchedKeywords(makeListing(), ["java", "senior", "rust"]);
    expect(matched).toContain("java");
    expect(matched).toContain("senior");
    expect(matched).not.toContain("rust");
  });

  it("is case-insensitive", () => {
    expect(matchedKeywords(makeListing({ title: "JAVA Developer" }), ["java"])).toEqual(["java"]);
  });

  it("does not match 'javascript' for the 'java' keyword (word boundaries)", () => {
    const jsListing = makeListing({
      title: "Senior JavaScript Developer",
      tags: ["react"],
    });
    expect(matchesKeywords(jsListing, ["java"])).toBe(false);
    expect(matchedKeywords(jsListing, ["java", "senior"])).toEqual(["senior"]);
  });

  it("still matches multi-word phrases on boundaries", () => {
    expect(matchesKeywords(makeListing(), ["ring boo"])).toBe(false);
    expect(matchesKeywords(makeListing(), ["spring boot"])).toBe(true);
  });
});
