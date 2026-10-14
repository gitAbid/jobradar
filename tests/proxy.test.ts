import { describe, expect, it, vi } from "vitest";

// next-auth pulls in next/server (unresolvable under vitest); only isPublicPath is under test
vi.mock("next-auth", () => ({ default: () => ({ auth: (f: unknown) => f }) }));
vi.mock("next/server", () => ({ NextResponse: {} }));

import { isPublicPath } from "@/proxy";
import { sanitizeCallbackUrl } from "@/lib/callback-url";

describe("isPublicPath", () => {
  it.each([
    ["/signin", true],
    ["/api/auth/session", true],
    ["/api/auth/callback/google", true],
    ["/api/v1/jobs", true],
    ["/api/refresh/cron", true],
    ["/api/health", true],
    ["/api/refresh", true],
    ["/bot", true],
    ["/_next/static/a.js", true],
    ["/robots.txt", true],
    ["/favicon.ico", true],
    ["/logo.png", true],
    ["/", true],
    ["/onboarding", false],
    ["/manifest.webmanifest", true],
    ["/opengraph-image", true],
    ["/apple-icon", true],
    ["/following", false],
    ["/settings", false],
    ["/saved", false],
    ["/admin/boards", false],
    ["/signinx", false],
    ["/admin/boards/1", false],
  ])("%s -> %s", (p, expected) => {
    expect(isPublicPath(p)).toBe(expected);
  });
});

describe("sanitizeCallbackUrl", () => {
  it.each(["//evil.com", "https://evil.com", "/\\evil", "javascript:alert(1)", "", undefined, "/\t/evil.com"])(
    "rejects %s",
    (v) => expect(sanitizeCallbackUrl(v)).toBe("/"),
  );
  it("accepts relative paths", () => {
    expect(sanitizeCallbackUrl("/following?x=1")).toBe("/following?x=1");
  });
});
