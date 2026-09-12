import { describe, expect, it } from "vitest";
import { freshnessOf } from "@/lib/freshness";

const NOW = Date.parse("2026-08-29T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const daysAhead = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe("freshnessOf", () => {
  it("marks listings posted within 3 days as fresh", () => {
    expect(freshnessOf({ postedAt: daysAgo(0.5), deadline: null }, NOW)).toEqual({
      tier: "fresh",
      label: "New",
    });
    expect(freshnessOf({ postedAt: daysAgo(3), deadline: null }, NOW)).toEqual({
      tier: "fresh",
      label: "New",
    });
  });

  it("keeps 4–10 day old listings quiet (recent)", () => {
    const info = freshnessOf({ postedAt: daysAgo(5), deadline: null }, NOW);
    expect(info.tier).toBe("recent");
    expect(info.label).toBeNull();
  });

  it("keeps old listings quiet (aging)", () => {
    const info = freshnessOf({ postedAt: daysAgo(30), deadline: null }, NOW);
    expect(info.tier).toBe("aging");
    expect(info.label).toBeNull();
  });

  it("flags deadlines within 3 days as closing, with days left", () => {
    expect(freshnessOf({ postedAt: daysAgo(40), deadline: daysAhead(2) }, NOW)).toEqual({
      tier: "closing",
      label: "Closes in 2d",
    });
    // hours away → generic "closing soon" instead of "0d"/"1d"
    expect(freshnessOf({ postedAt: daysAgo(1), deadline: daysAhead(0.2) }, NOW)).toEqual({
      tier: "closing",
      label: "Closing soon",
    });
  });

  it("marks passed deadlines as expired, overriding young postedAt", () => {
    expect(freshnessOf({ postedAt: daysAgo(1), deadline: daysAhead(-1) }, NOW)).toEqual({
      tier: "expired",
      label: "Deadline passed",
    });
  });

  it("deadline urgency wins over age freshness", () => {
    // posted a month ago but deadline near → closing (not aging, not fresh)
    expect(freshnessOf({ postedAt: daysAgo(30), deadline: daysAhead(3) }, NOW).tier).toBe("closing");
    // posted today with a far deadline → still fresh by age
    expect(freshnessOf({ postedAt: daysAgo(1), deadline: daysAhead(10) }, NOW).tier).toBe("fresh");
  });

  it("returns unknown and no label when dates are missing or malformed", () => {
    expect(freshnessOf({ postedAt: null, deadline: null }, NOW)).toEqual({
      tier: "unknown",
      label: null,
    });
    expect(freshnessOf({ postedAt: "not-a-date", deadline: "" }, NOW)).toEqual({
      tier: "unknown",
      label: null,
    });
  });
});
