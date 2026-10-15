import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

type FakeRes = { status: number; headers?: Record<string, string>; chunks?: string[] };
const script: FakeRes[] = [];
const seen: { host?: string; lookupAll?: unknown; headers?: Record<string, string> }[] = [];

vi.mock("node:http", () => ({
  request: (opts: { hostname: string; headers: Record<string, string>; lookup: (h: string, o: unknown, cb: (e: unknown, a: unknown) => void) => void }, cb: (r: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      const f = script.shift() as FakeRes;
      opts.lookup(opts.hostname, { all: true }, (_e: unknown, a: unknown) => {
        seen.push({ host: opts.hostname, lookupAll: a, headers: opts.headers });
      });
      const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
      res.statusCode = f.status;
      res.statusMessage = "X";
      res.headers = f.headers ?? {};
      res.complete = false;
      res.resume = () => {};
      res.destroy = () => {};
      cb(res);
      setImmediate(() => {
        for (const c of f.chunks ?? []) res.emit("data", Buffer.from(c));
        res.complete = true;
        res.emit("end");
        res.emit("close");
      });
    };
    return req;
  },
}));

import { assertSafeUrl, isBlockedAddress, safeFetch, type Resolver } from "@/lib/safe-fetch";

const pub: Resolver = async () => [{ address: "93.184.216.34", family: 4 }];

beforeEach(() => {
  script.length = 0;
  seen.length = 0;
});

describe("isBlockedAddress", () => {
  it.each([
    ["127.0.0.1", 4], ["10.1.2.3", 4], ["172.16.0.1", 4], ["192.168.1.1", 4],
    ["169.254.169.254", 4], ["100.64.0.1", 4], ["0.0.0.0", 4], ["0.1.2.3", 4],
    ["::1", 6], ["::", 6], ["::127.0.0.1", 6], ["fc00::1", 6], ["fd12::1", 6], ["fe80::1", 6],
    ["::ffff:127.0.0.1", 6], ["::ffff:7f00:1", 6], ["::ffff:10.0.0.1", 6],
    ["::ffff:a9fe:a9fe", 6], ["::ffff:100.64.0.1", 6], ["::ffff:0.0.0.0", 6],
  ] as const)("blocks %s", (a, f) => {
    expect(isBlockedAddress(a, f)).toBe(true);
  });
  it.each([["8.8.8.8", 4], ["::ffff:8.8.8.8", 6], ["2606:4700::1", 6]] as const)(
    "allows %s",
    (a, f) => expect(isBlockedAddress(a, f)).toBe(false),
  );
});

describe("safeFetch", () => {
  it("rejects non-http schemes", async () => {
    await expect(safeFetch("file:///etc/passwd", { resolver: pub })).rejects.toThrow(/protocol/);
    await expect(safeFetch("ftp://example.com/", { resolver: pub })).rejects.toThrow(/protocol/);
  });

  it("rejects literal-IP hosts without resolving", async () => {
    const resolver = vi.fn(pub);
    for (const u of ["http://127.0.0.1/", "http://[::1]/", "http://[::ffff:7f00:1]/", "http://2130706433/", "http://169.254.169.254/"]) {
      await expect(safeFetch(u, { resolver })).rejects.toThrow(/blocked/);
    }
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects if ANY resolved address is blocked", async () => {
    const resolver: Resolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ];
    await expect(safeFetch("http://evil.example/", { resolver })).rejects.toThrow(/blocked/);
  });

  it("pins the connection to validated addresses", async () => {
    script.push({ status: 200, chunks: ["hello"] });
    const res = await safeFetch("http://ok.example/", { resolver: pub });
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe("hello");
    expect(seen[0]?.lookupAll).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("re-validates every redirect hop", async () => {
    script.push({ status: 302, headers: { location: "http://internal.example/x" } });
    const resolver: Resolver = async (h) =>
      h === "internal.example"
        ? [{ address: "192.168.0.1", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }];
    await expect(safeFetch("http://ok.example/", { resolver })).rejects.toThrow(/blocked/);
  });

  it("follows a safe redirect", async () => {
    script.push({ status: 301, headers: { location: "/b" } }, { status: 200, chunks: ["done"] });
    const res = await safeFetch("http://ok.example/a", { resolver: pub });
    expect(await res.text()).toBe("done");
  });

  it("drops credential headers on a cross-origin redirect", async () => {
    script.push(
      { status: 302, headers: { location: "http://other.example/b" } },
      { status: 200, chunks: ["ok"] },
    );
    await safeFetch("http://ok.example/a", {
      resolver: pub,
      headers: { "User-Agent": "ua", Authorization: "Basic x", "X-Api-Key": "k" },
    });
    expect(seen[0]?.headers).toMatchObject({ Authorization: "Basic x", "X-Api-Key": "k" });
    expect(seen[1]?.headers).toMatchObject({ "User-Agent": "ua" });
    expect(seen[1]?.headers).not.toHaveProperty("Authorization");
    expect(seen[1]?.headers).not.toHaveProperty("X-Api-Key");
  });

  it("stops after 5 redirects", async () => {
    for (let i = 0; i < 6; i++) script.push({ status: 302, headers: { location: "/n" } });
    await expect(safeFetch("http://ok.example/", { resolver: pub })).rejects.toThrow(/redirects/);
  });

  it("caps the body at 10 MB", async () => {
    const big = "x".repeat(6 * 1024 * 1024);
    script.push({ status: 200, chunks: [big, big] });
    await expect(safeFetch("http://ok.example/", { resolver: pub })).rejects.toThrow(/too large/);
  });
});

describe("assertSafeUrl", () => {
  it("rejects blocked literals", async () => {
    await expect(assertSafeUrl("http://127.0.0.1/", pub)).rejects.toThrow(/blocked/);
    await expect(assertSafeUrl("file:///etc/passwd", pub)).rejects.toThrow(/protocol/);
  });
  it("rejects blocked resolved addresses", async () => {
    await expect(
      assertSafeUrl("http://x.example/", async () => [{ address: "10.0.0.1", family: 4 }]),
    ).rejects.toThrow(/blocked/);
  });
  it("allows public hosts", async () => {
    await expect(assertSafeUrl("https://ok.example/", pub)).resolves.toBeUndefined();
  });
});
