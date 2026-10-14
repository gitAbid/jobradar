import { describe, expect, it } from "vitest";
import { timeAgo } from "@/lib/time";

const NOW = Date.parse("2026-08-29T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3_600_000;

describe("timeAgo", () => {
  it("says just now under an hour", () => {
    expect(timeAgo(ago(10 * 60_000), NOW)).toBe("just now");
  });
  it("uses hours then days", () => {
    expect(timeAgo(ago(5 * H), NOW)).toBe("5h ago");
    expect(timeAgo(ago(48 * H), NOW)).toBe("2d ago");
  });
  it("uses months beyond 30 days", () => {
    expect(timeAgo(ago(30 * 24 * H), NOW)).toBe("30d ago");
    expect(timeAgo(ago(65 * 24 * H), NOW)).toBe("2mo ago");
  });
});
