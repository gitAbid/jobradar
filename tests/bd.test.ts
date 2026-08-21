import { describe, expect, it } from "vitest";
import { isBangladeshRelevant } from "@/lib/bd";

describe("isBangladeshRelevant", () => {
  it("matches BD cities in the location", () => {
    expect(isBangladeshRelevant({ location: "Dhaka, Bangladesh", title: "Java Dev" })).toBe(true);
    expect(isBangladeshRelevant({ location: "Mohakhali, Dhaka", title: "Backend Engineer" })).toBe(true);
    expect(isBangladeshRelevant({ location: "Chattogram", title: "Lead Engineer" })).toBe(true);
  });

  it("matches remote roles open to Bangladeshi candidates via text", () => {
    expect(
      isBangladeshRelevant({
        location: "Remote",
        title: "Senior Backend Engineer",
        searchText: "we hire remotely in bangladesh or india. spring boot required.",
      }),
    ).toBe(true);
  });

  it("rejects unrelated locations and texts", () => {
    expect(
      isBangladeshRelevant({
        location: "Berlin, Germany",
        title: "Java Engineer",
        searchText: "relocate to germany. visa sponsorship available.",
      }),
    ).toBe(false);
    // "bangladesh" must not match inside other words
    expect(
      isBangladeshRelevant({ location: "", title: "x", searchText: "unrelated content only" }),
    ).toBe(false);
  });
});
