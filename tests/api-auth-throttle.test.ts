import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setRemoteHarness } from "@/db";
import { createApiKey, InMemoryKeyStore, type KeyStore } from "@/lib/api/keys";
import { apiKeys } from "@/lib/api/keys-store";
import { clientId, jobsListResponse, type FeedLoader } from "@/lib/api/jobs";

const A = "00000000-0000-4000-8000-00000000000a";
const empty: FeedLoader = async () => ({
  ok: true,
  feed: {
    view: async () => ({ entries: [], facets: [], currentPage: 1, totalPages: 1, totalVisible: 0 }) as never,
    byId: async () => null,
  },
});

const call = (store: KeyStore, ip: string, key?: string) => {
  const headers: Record<string, string> = { "x-forwarded-for": `${ip}, 10.0.0.1` };
  if (key) headers.authorization = `Bearer ${key}`;
  return jobsListResponse(new Request("https://jobradar.local/api/v1/jobs", { headers }), store, empty);
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("clientId", () => {
  it("prefers x-real-ip, else the first x-forwarded-for hop, and never exposes the raw IP", () => {
    const r = (h: Record<string, string>) => new Request("https://x.io", { headers: h });
    const id = clientId(r({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }));
    expect(id).toBe(clientId(r({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })));
    expect(id).not.toBe(clientId(r({ "x-forwarded-for": "9.9.9.9" })));
    expect(id).not.toContain("1.2.3.4");
    expect(clientId(r({}))).toBe(clientId(r({})));
  });
});

describe("failed-key throttle (in-memory store)", () => {
  let store: InMemoryKeyStore;
  let KEY: string;
  beforeEach(async () => {
    vi.stubEnv("API_AUTH_FAIL_LIMIT_PER_HOUR", "3");
    store = new InMemoryKeyStore();
    KEY = (await createApiKey(store, "k", A)).plaintext;
  });

  it("401s up to the limit, then 429s with Retry-After", async () => {
    for (let i = 0; i < 3; i++) expect((await call(store, "1.1.1.1", "jrk_bad")).status).toBe(401);
    const over = await call(store, "1.1.1.1", "jrk_bad");
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: "rate_limited" });
    const retry = Number(over.headers.get("retry-after"));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(3600);
    expect(over.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("once blocked, the client is turned away without any key lookup", async () => {
    for (let i = 0; i < 4; i++) await call(store, "1.1.1.1", "jrk_bad");
    const lookup = vi.spyOn(store, "findByHash");
    const hits = vi.spyOn(store, "hitAuthFailure");
    expect((await call(store, "1.1.1.1", "jrk_bad")).status).toBe(429);
    expect((await call(store, "1.1.1.1", KEY)).status).toBe(429); // even a valid key, from that client
    expect(lookup).not.toHaveBeenCalled();
    expect(hits).not.toHaveBeenCalled();
  });

  it("is per client: other IPs and valid keys are unaffected", async () => {
    for (let i = 0; i < 4; i++) await call(store, "1.1.1.1", "jrk_bad");
    expect((await call(store, "2.2.2.2", "jrk_bad")).status).toBe(401);
    expect((await call(store, "2.2.2.2", KEY)).status).toBe(200);
  });

  it("valid keys and missing keys never count", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await call(store, "1.1.1.1", KEY)).status).toBe(200);
      expect((await call(store, "1.1.1.1")).status).toBe(401);
    }
    expect((await call(store, "1.1.1.1", "jrk_bad")).status).toBe(401);
  });

  it("revoked keys count as failures", async () => {
    const { plaintext, key } = await createApiKey(store, "old", A);
    await store.revoke(key.id, A, new Date().toISOString());
    for (let i = 0; i < 3; i++) expect((await call(store, "1.1.1.1", plaintext)).status).toBe(403);
    expect((await call(store, "1.1.1.1", plaintext)).status).toBe(429);
  });

  it("unblocks when the window ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T10:30:00Z"));
    for (let i = 0; i < 4; i++) await call(store, "1.1.1.1", "jrk_bad");
    expect((await call(store, "1.1.1.1", KEY)).status).toBe(429);
    vi.setSystemTime(new Date("2026-10-15T11:00:01Z"));
    expect((await call(store, "1.1.1.1", KEY)).status).toBe(200);
    expect((await call(store, "1.1.1.1", "jrk_bad")).status).toBe(401);
  });
});

describe("failed-key throttle (Postgres store, migration 008)", () => {
  let db: PGlite;
  beforeEach(async () => {
    vi.stubEnv("API_AUTH_FAIL_LIMIT_PER_HOUR", "2");
    db = new PGlite();
    const dir = join(process.cwd(), "db/migrations");
    for (const f of readdirSync(dir).sort()) if (f.endsWith(".sql")) await db.exec(readFileSync(join(dir, f), "utf8"));
    setRemoteHarness({
      query: async (sql, params) => (await db.query(sql, params)).rows as Record<string, unknown>[],
      run: async (sql, params) => (await db.query(sql, params)).affectedRows ?? 0,
    });
  });
  afterEach(async () => {
    setRemoteHarness(null);
    await db.close();
  });

  // apiKeys() is a process-wide singleton, so each test uses its own client IP.
  it("counts failures per hashed client in api_auth_fail and 429s over the limit", async () => {
    expect((await call(apiKeys(), "3.3.3.3", "jrk_bad")).status).toBe(401);
    expect((await call(apiKeys(), "3.3.3.3", "jrk_bad")).status).toBe(401);
    const over = await call(apiKeys(), "3.3.3.3", "jrk_bad");
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
    const rows = (await db.query<{ client: string; count: number }>("select client, count from api_auth_fail")).rows;
    expect(rows).toEqual([{ client: expect.any(String), count: 3 }]);
    expect(rows[0].client).not.toContain("3.3.3.3");
  });

  it("a fresh instance consults the shared counter (429 on its next failure)", async () => {
    const client = clientId(new Request("https://x.io", { headers: { "x-forwarded-for": "4.4.4.4" } }));
    await db.query("insert into api_auth_fail (client, window_start, count) values ($1, date_trunc('hour', now()), 50)", [client]);
    expect((await call(apiKeys(), "4.4.4.4", "jrk_bad")).status).toBe(429);
  });

  it("still 401s (does not 500) when the limiter table is unavailable", async () => {
    await db.exec("drop table api_auth_fail");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call(apiKeys(), "5.5.5.5", "jrk_bad")).status).toBe(401);
    expect(err).toHaveBeenCalled();
  });
});
