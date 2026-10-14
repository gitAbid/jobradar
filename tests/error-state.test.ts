import { describe, expect, it } from "vitest";
import { healthSaysDbDown, isDbUnavailableError } from "@/lib/error-state";
import { hasActiveFilters } from "@/lib/empty-state";
import { RemoteTimeoutError } from "@/db/errors";

describe("isDbUnavailableError", () => {
  it("treats connection failures as unavailable", () => {
    expect(isDbUnavailableError(new Error("connect ECONNREFUSED 1.2.3.4:5432"))).toBe(true);
    expect(isDbUnavailableError(new RemoteTimeoutError("q", 100))).toBe(true);
  });
  it("does not misclassify SQL bugs", () => {
    expect(isDbUnavailableError(new Error('column "x" does not exist'))).toBe(false);
  });
  it("cannot classify the redacted production message", () => {
    expect(
      isDbUnavailableError({ message: "An error occurred in the Server Components render.", digest: "123" }),
    ).toBe(false);
  });
});

describe("healthSaysDbDown", () => {
  it("detects 503 or db:down", () => {
    expect(healthSaysDbDown(503, null)).toBe(true);
    expect(healthSaysDbDown(200, { db: "down" })).toBe(true);
    expect(healthSaysDbDown(200, { db: "up" })).toBe(false);
    expect(healthSaysDbDown(200, null)).toBe(false);
  });
});

describe("hasActiveFilters", () => {
  it("distinguishes filters from none", () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ page: "2", showAll: "1" })).toBe(false);
    expect(hasActiveFilters({ q: "react" })).toBe(true);
    expect(hasActiveFilters({ skill: ["a"] })).toBe(true);
    expect(hasActiveFilters({ skill: [] })).toBe(false);
  });
});
