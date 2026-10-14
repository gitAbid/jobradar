import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
  updateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));
vi.mock("@/lib/refresh", () => ({ refreshBoard: vi.fn(async () => ({ ok: true, fetched: 0, inserted: 0 })) }));

import { setRemoteHarness } from "@/db";
import * as actions from "@/app/actions";
import { revokeApiKeyAction } from "@/app/api-keys/actions";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const session = (id: string, role: "admin" | "user") => ({ user: { id, email: `${role}@x.io`, role } });
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

let db: PGlite;

beforeEach(async () => {
  authMock.mockReset();
  revalidatePath.mockReset();
  db = new PGlite();
  for (const f of readdirSync(join(process.cwd(), "db/migrations")).sort())
    if (f.endsWith(".sql")) await db.exec(readFileSync(join(process.cwd(), "db/migrations", f), "utf8"));
  await db.query("insert into users (id, email, role) values ($1,'a@x.io','admin'), ($2,'b@x.io','user')", [A, B]);
  await db.exec(`
    insert into boards (name, type, url) values ('Bd','api','http://x');
    insert into listings (board_id, external_id, title, company, url, fetched_at) values (1,'1','One','Acme','u', now());
  `);
  setRemoteHarness({
    query: async (sql, params) => (await db.query(sql, params)).rows as Record<string, unknown>[],
    run: async (sql, params) => (await db.query(sql, params)).affectedRows ?? 0,
  });
});
afterEach(async () => {
  setRemoteHarness(null);
  await db.close();
});

describe("action result shape", () => {
  it("returns { ok: true } on success", async () => {
    authMock.mockResolvedValue(session(B, "user"));
    expect(await actions.setListingStatusAction(form({ id: "1", status: "favorite" }))).toEqual({ ok: true });
    expect(await actions.toggleFollowCompanyAction(form({ company: "Acme" }))).toEqual({ ok: true });
    expect(await actions.togglePinCountryAction(form({ country: "Canada" }))).toEqual({ ok: true });
    expect(await actions.saveSettingsAction(form({ global_keywords: "x" }))).toEqual({ ok: true });
  });

  it("returns { ok: false, error } for invalid input", async () => {
    authMock.mockResolvedValue(session(B, "user"));
    expect(await actions.setListingStatusAction(form({ id: "1", status: "bogus" }))).toEqual({
      ok: false,
      error: expect.any(String),
    });
    expect(await actions.toggleFollowCompanyAction(form({ company: " " }))).toMatchObject({ ok: false });
  });

  it("returns an error result (and writes nothing) for anonymous and non-admin callers", async () => {
    authMock.mockResolvedValue(null);
    expect(await actions.setListingStatusAction(form({ id: "1", status: "favorite" }))).toEqual({
      ok: false,
      error: "Sign in required",
    });
    authMock.mockResolvedValue(session(B, "user"));
    expect(await actions.deleteBoardAction(form({ id: "1" }))).toEqual({ ok: false, error: "Not allowed" });
    expect((await db.query("select 1 from boards")).rows).toHaveLength(1);
    expect((await db.query("select 1 from user_listing_state")).rows).toHaveLength(0);
  });

  it("addBoardAction reports per-field validation errors", async () => {
    authMock.mockResolvedValue(session(A, "admin"));
    const res = await actions.addBoardAction(form({ name: "", type: "api", url: "not a url" }));
    expect(res).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String), url: expect.any(String) } });
    expect((await db.query("select 1 from boards")).rows).toHaveLength(1);
  });

  it("addBoardAction surfaces a duplicate name as an error", async () => {
    authMock.mockResolvedValue(session(A, "admin"));
    const dup = await actions.addBoardAction(form({ name: "Bd", type: "api", url: "http://y.example" }));
    expect(dup).toMatchObject({ ok: false, fieldErrors: { name: expect.stringContaining("already exists") } });
    expect(await actions.addBoardAction(form({ name: "New", type: "rss", url: "http://z.example" }))).toEqual({ ok: true });
  });

  it("revokeApiKeyAction returns ok / error", async () => {
    authMock.mockResolvedValue(null);
    expect(await revokeApiKeyAction(form({ id: "1" }))).toEqual({ ok: false, error: "Sign in required" });
    authMock.mockResolvedValue(session(B, "user"));
    expect(await revokeApiKeyAction(form({ id: "x" }))).toEqual({ ok: false, error: "Invalid key." });
    expect(await revokeApiKeyAction(form({ id: "1" }))).toEqual({ ok: true });
  });

  it("user-state commits revalidate /bangladesh too", async () => {
    authMock.mockResolvedValue(session(B, "user"));
    await actions.setListingStatusAction(form({ id: "1", status: "hidden" }));
    expect(revalidatePath).toHaveBeenCalledWith("/bangladesh");
    revalidatePath.mockReset();
    authMock.mockResolvedValue(session(A, "admin"));
    await actions.toggleBoardEnabledAction(form({ id: "1" }));
    expect(revalidatePath).toHaveBeenCalledWith("/bangladesh");
  });
});
