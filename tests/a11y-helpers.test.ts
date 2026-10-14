import { describe, expect, it } from "vitest";
import { skillChipHref } from "@/lib/chip-href";
import { isoDate, timeAgo } from "@/lib/time";

describe("skillChipHref", () => {
  it("keeps other filters on the dashboard and drops page", () => {
    expect(skillChipHref("/", "country=Bangladesh&page=3", "React")).toBe("/?country=Bangladesh&q=React");
  });
  it("replaces an existing q", () => {
    expect(skillChipHref("/", "q=old&visa=1", "Go")).toBe("/?q=old".replace("old", "Go") + "&visa=1");
  });
  it("goes to /?q= from pages without q support", () => {
    expect(skillChipHref("/following", "company=Acme", "C++")).toBe("/?q=C%2B%2B");
  });
});

describe("relative time helpers", () => {
  it("formats the absolute fallback as an ISO date", () => {
    expect(isoDate("2026-03-04T10:00:00.000Z")).toBe("2026-03-04");
  });
  it("formats relative text", () => {
    const now = Date.parse("2026-03-10T00:00:00Z");
    expect(timeAgo("2026-03-07T00:00:00Z", now)).toBe("3d ago");
  });
});
