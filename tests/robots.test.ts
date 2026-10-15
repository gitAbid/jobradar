import { beforeEach, describe, expect, it, vi } from "vitest";

const safeFetch = vi.fn();
vi.mock("@/lib/safe-fetch", () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a), BOT_UA: "JobRadarBot/1.0 (+http://x/bot)" }));

import { clearRobotsCache, isAllowedByRobots, isPathAllowed, parseRobots, RobotsDisallowedError } from "@/lib/robots";

const ok = (body: string) => ({ ok: true, status: 200, text: async () => body });
const allowed = (txt: string, path: string) => isPathAllowed(parseRobots(txt), path);

describe("robots parser", () => {
  it("agent-specific group wins over *", () => {
    const t = "User-agent: *\nDisallow: /\n\nUser-agent: JobRadarBot\nDisallow: /private";
    expect(allowed(t, "/jobs")).toBe(true);
    expect(allowed(t, "/private/x")).toBe(false);
  });
  it("falls back to * group", () => {
    expect(allowed("User-agent: *\nDisallow: /api/", "/api/1")).toBe(false);
  });
  it("longest match wins", () => {
    const t = "User-agent: *\nDisallow: /a\nAllow: /a/b";
    expect(allowed(t, "/a/b/c")).toBe(true);
    expect(allowed(t, "/a/x")).toBe(false);
  });
  it("Allow beats Disallow on tie", () => {
    expect(allowed("User-agent: *\nDisallow: /a\nAllow: /a", "/a")).toBe(true);
  });
  it("wildcards and $", () => {
    const t = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /x*y";
    expect(allowed(t, "/f/doc.pdf")).toBe(false);
    expect(allowed(t, "/f/doc.pdf?x=1")).toBe(true);
    expect(allowed(t, "/xaay")).toBe(false);
  });
  it("empty Disallow allows all", () => {
    expect(allowed("User-agent: *\nDisallow:", "/anything")).toBe(true);
  });
  it("multiple agents share a group", () => {
    const t = "User-agent: foo\nUser-agent: jobradarbot\nDisallow: /";
    expect(allowed(t, "/a")).toBe(false);
  });
  it("non-rule records between agents don't split a group", () => {
    const t = "User-agent: foo\nCrawl-delay: 5\nUser-agent: jobradarbot\nDisallow: /x";
    expect(allowed(t, "/x")).toBe(false);
  });
  it("an agent line after rules starts a new group", () => {
    const t = "User-agent: jobradarbot\nDisallow: /x\nUser-agent: other\nDisallow: /y";
    expect(allowed(t, "/x")).toBe(false);
    expect(allowed(t, "/y")).toBe(true);
  });
});

describe("isAllowedByRobots", () => {
  beforeEach(() => {
    safeFetch.mockReset();
    clearRobotsCache();
  });
  it("caches per origin", async () => {
    safeFetch.mockResolvedValue(ok("User-agent: *\nDisallow: /no"));
    expect(await isAllowedByRobots("https://a.test/jobs")).toBe(true);
    expect(await isAllowedByRobots("https://a.test/no/1")).toBe(false);
    expect(safeFetch).toHaveBeenCalledTimes(1);
  });
  it("404 allows", async () => {
    safeFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "" });
    expect(await isAllowedByRobots("https://b.test/x")).toBe(true);
  });
  it("429 disallows", async () => {
    safeFetch.mockResolvedValue({ ok: false, status: 429, text: async () => "" });
    expect(await isAllowedByRobots("https://f.test/x")).toBe(false);
  });
  it("500 and network error disallow", async () => {
    safeFetch.mockResolvedValue({ ok: false, status: 500, text: async () => "" });
    expect(await isAllowedByRobots("https://c.test/x")).toBe(false);
    safeFetch.mockRejectedValue(new Error("down"));
    expect(await isAllowedByRobots("https://d.test/x")).toBe(false);
  });
  it("adapter fetch throws RobotsDisallowedError", async () => {
    safeFetch.mockResolvedValue(ok("User-agent: *\nDisallow: /"));
    const { fetchRss } = await import("@/lib/adapters");
    const p = fetchRss({ id: 1, name: "n", type: "rss", url: "https://e.test/feed" } as never);
    await expect(p).rejects.toBeInstanceOf(RobotsDisallowedError);
    await expect(p).rejects.toThrow(/blocked by robots\.txt/);
    expect(safeFetch).toHaveBeenCalledTimes(1); // only robots.txt
  });
});
