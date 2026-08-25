import { describe, expect, it } from "vitest";
import { isNavLinkActive } from "@/lib/navigation";

describe("isNavLinkActive", () => {
  it("matches the dashboard only at the root route", () => {
    expect(isNavLinkActive("/", "/")).toBe(true);
    expect(isNavLinkActive("/boards", "/")).toBe(false);
  });

  it("matches nested routes without matching similarly named routes", () => {
    expect(isNavLinkActive("/following", "/following")).toBe(true);
    expect(isNavLinkActive("/following/company", "/following")).toBe(true);
    expect(isNavLinkActive("/applied", "/following")).toBe(false);
  });
});
