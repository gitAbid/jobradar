import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

import { setRemoteHarness } from "@/db";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/settings/api-keys/actions";
import { hashKey, listApiKeys } from "@/lib/api/keys";
import { apiKeys } from "@/lib/api/keys-store";
import { jobsListResponse, loadFeedSafe } from "@/lib/api/jobs";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const session = (id: string) => ({ user: { id, email: `u${id.slice(-1)}@x.io`, role: "user" } });

let db: PGlite;

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const call = (key: string) =>
  jobsListResponse(
    new Request("https://jobradar.local/api/v1/jobs", { headers: { authorization: `Bearer ${key}` } }),
    apiKeys(),
    loadFeedSafe,
  );
async function makeKey(userId: string): Promise<string> {
  authMock.mockResolvedValue(session(userId));
  const st = await createApiKeyAction({}, form({ name: "k" }));
  return st.plaintext as string;
}

beforeEach(async () => {
  authMock.mockReset();
  db = new PGlite();
  for (const f of readdirSync(join(process.cwd(), "db/migrations")).sort())
    if (f.endsWith(".sql")) await db.exec(readFileSync(join(process.cwd(), "db/migrations", f), "utf8"));
  await db.query("insert into users (id, email, role) values ($1,'a@x.io','user'), ($2,'b@x.io','user')", [A, B]);
  await db.exec(`
    insert into boards (name, type, url) values ('Bd','api','http://x');
    insert into listings (board_id, external_id, title, company, url, fetched_at)
      values (1,'1','One','Acme','u', now()), (1,'2','Two','Beta','u', now());
  `);
  setRemoteHarness({
    query: async (sql, params) => (await db.query(sql, params)).rows as Record<string, unknown>[],
    run: async (sql, params) => (await db.query(sql, params)).affectedRows ?? 0,
  });
});

afterEach(() => {
  setRemoteHarness(null);
  vi.useRealTimers();
  delete process.env.API_RATE_LIMIT_PER_HOUR;
});

describe("API key ownership", () => {
  it("create sets user_id; list and revoke are owner-scoped", async () => {
    const keyA = await makeKey(A);
    await makeKey(B);
    const [rowA] = (await db.query<{ id: number; user_id: string }>("select id, user_id from api_keys where user_id = $1", [A])).rows;
    expect(rowA.user_id).toBe(A);

    expect((await listApiKeys(apiKeys(), A)).map((k) => k.id)).toEqual([rowA.id]);
    expect(await listApiKeys(apiKeys(), B)).toHaveLength(1);

    // B tries to revoke A's key: no-op
    authMock.mockResolvedValue(session(B));
    await revokeApiKeyAction(form({ id: String(rowA.id) }));
    expect((await call(keyA)).status).toBe(200);

    authMock.mockResolvedValue(session(A));
    await revokeApiKeyAction(form({ id: String(rowA.id) }));
    expect((await call(keyA)).status).toBe(403);
  });

  it("rejects legacy keys with no owner", async () => {
    await db.query("insert into api_keys (name, key_hash, prefix, created_at) values ('old', $1, 'jrk_legacy__', now())", [hashKey("jrk_legacy")]);
    expect((await call("jrk_legacy")).status).toBe(401);
  });

  it("serves the owner's state: hidden excluded for them only", async () => {
    const keyA = await makeKey(A);
    const keyB = await makeKey(B);
    await db.query("insert into user_listing_state (user_id, listing_id, status) values ($1, 1, 'hidden')", [A]);
    const ids = async (k: string) =>
      (((await (await call(k)).json()) as { data: { id: number }[] }).data).map((j) => j.id);
    expect(await ids(keyA)).toEqual([2]);
    expect((await ids(keyB)).sort()).toEqual([1, 2]);
  });
});

describe("API rate limit", () => {
  const retry = (r: Response) => Number(r.headers.get("retry-after"));

  it("429s over the limit with Retry-After, then resets in a new window", async () => {
    process.env.API_RATE_LIMIT_PER_HOUR = "3";
    const key = await makeKey(A);
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < 3; i++) expect((await call(key)).status).toBe(200);
    const over = await call(key);
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: "rate_limited" });
    expect(retry(over)).toBeGreaterThan(0);
    expect(retry(over)).toBeLessThanOrEqual(3600);
    vi.useRealTimers();

    // slide the stored window into the past = the next hour started
    await db.query("update api_rate set window_start = window_start - interval '1 hour'");
    expect((await call(key)).status).toBe(200);
  });

  it("fails closed with 503 when the rate store errors", async () => {
    const key = await makeKey(A);
    await db.exec("drop table api_rate");
    const res = await call(key);
    expect(res.status).toBe(503);
  });
});
