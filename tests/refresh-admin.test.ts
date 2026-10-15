import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => {},
  after: vi.fn(),
}));
const startRefreshRun = vi.fn();
const readCurrentRun = vi.fn(async () => ({ id: "r1" }));
vi.mock("@/lib/refresh-run-store", () => ({ readCurrentRun: () => readCurrentRun() }));

import { setRemoteHarness } from "@/db";
import { expireOldListings } from "@/lib/refresh";
import * as refreshMod from "@/lib/refresh";
import { POST } from "@/app/api/refresh/route";
import { GET } from "@/app/api/refresh/status/route";

const A = "00000000-0000-4000-8000-00000000000a";
const session = (role: string) => ({ user: { id: A, email: "a@x.io", role } });

describe("admin-only refresh routes", () => {
  beforeEach(() => {
    authMock.mockReset();
    readCurrentRun.mockClear();
    startRefreshRun.mockReset();
    vi.spyOn(refreshMod, "startRefreshRun").mockImplementation(startRefreshRun);
  });
  afterEach(() => vi.restoreAllMocks());

  const post = () => POST(new Request("https://x.io/api/refresh", { method: "POST" }));

  it("401 anonymous", async () => {
    authMock.mockResolvedValue(null);
    for (const res of [await post(), await GET()]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    expect(readCurrentRun).not.toHaveBeenCalled();
  });

  it("403 non-admin", async () => {
    authMock.mockResolvedValue(session("user"));
    for (const res of [await post(), await GET()]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
    expect(readCurrentRun).not.toHaveBeenCalled();
    expect(startRefreshRun).not.toHaveBeenCalled();
  });

  it("status works for admin", async () => {
    authMock.mockResolvedValue(session("admin"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ run: { id: "r1" } });
  });
});

describe("expireOldListings", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = new PGlite();
    for (const f of readdirSync(join(process.cwd(), "db/migrations")).sort())
      if (f.endsWith(".sql")) await db.exec(readFileSync(join(process.cwd(), "db/migrations", f), "utf8"));
    await db.query("insert into users (id, email) values ($1,'a@x.io')", [A]);
    await db.exec(`
      insert into boards (name, type, url) values ('Bd','api','http://x');
      insert into listings (board_id, external_id, title, company, url, fetched_at)
        select 1, g::text, 'T'||g, 'C', 'u', now() - interval '60 days' from generate_series(1,7) g;
    `);
    // 1 favorite, 2 applied, 3 tags only, 4 legacy, 5 hidden only, 6 'new' no tags, 7 no state
    await db.exec(`
      insert into user_listing_state (user_id, listing_id, status, user_tags) values
        ('${A}',1,'favorite','[]'), ('${A}',2,'applied','[]'), ('${A}',3,'new','["x"]'),
        ('${A}',5,'hidden','[]'), ('${A}',6,'new','[]');
      insert into legacy_listing_state (listing_id, status, user_tags) values (4,'favorite','[]');
    `);
    setRemoteHarness({
      query: async (sql, params) => (await db.query(sql, params)).rows as Record<string, unknown>[],
      run: async (sql, params) => (await db.query(sql, params)).affectedRows ?? 0,
    });
  });
  afterEach(() => setRemoteHarness(null));

  it("keeps listings with favorite/applied/tags or legacy state", async () => {
    await expireOldListings();
    const ids = (await db.query<{ id: number }>("select id from listings order by id")).rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([1, 2, 3, 4]));
    expect(ids).not.toContain(7);
    expect(ids).not.toContain(6);
    expect(ids).not.toContain(5); // hidden-only listings expire
  });

  it("ignores legacy state once it has been claimed", async () => {
    await db.exec("insert into app_settings (key, value) values ('legacy_claimed', 'x')");
    await expireOldListings();
    const ids = (await db.query<{ id: number }>("select id from listings order by id")).rows.map((r) => r.id);
    expect(ids).toEqual([1, 2, 3]);
  });
});
