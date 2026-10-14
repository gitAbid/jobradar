import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: (t: string) => updateTag(t), cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("@/lib/refresh", () => ({ refreshBoard: vi.fn(async () => ({ ok: true, fetched: 0, inserted: 0 })) }));

import { listFollowedCompanies, listPinnedCountries, setRemoteHarness } from "@/db";
import {
  addBoardAction,
  addUserTagAction,
  removeUserTagAction,
  saveSettingsAction,
  setListingStatusAction,
  testBoardAction,
  toggleFollowCompanyAction,
  togglePinCountryAction,
} from "@/app/actions";
import { createApiKeyAction } from "@/app/settings/api-keys/actions";
import { runJobQuery, type SqlExec } from "@/lib/job-query";
import { getGlobalKeywords, getRefreshIntervalHours, isSoundEnabled } from "@/lib/settings";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const session = (id: string, role: "admin" | "user") => ({ user: { id, email: `${role}-${id.slice(-1)}@x.io`, role } });

let db: PGlite;
let exec: SqlExec;

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const feed = async (uid: string | null) =>
  (await runJobQuery(exec, { showAll: "1" }, [], { pageSize: 50 }, uid)).entries.map((e) => e.listing);

beforeEach(async () => {
  authMock.mockReset();
  updateTag.mockReset();
  db = new PGlite();
  for (const f of readdirSync(join(process.cwd(), "db/migrations")).sort())
    if (f.endsWith(".sql")) await db.exec(readFileSync(join(process.cwd(), "db/migrations", f), "utf8"));
  await db.query("insert into users (id, email, role) values ($1,'a@x.io','admin'), ($2,'b@x.io','user')", [A, B]);
  await db.exec(`
    insert into boards (name, type, url) values ('Bd','api','http://x');
    insert into listings (board_id, external_id, title, company, url, fetched_at)
      values (1,'1','One','Acme','u', now()), (1,'2','Two','Beta','u', now());
  `);
  setRemoteHarness({
    query: async (sql, params) => (await db.query(sql, params)).rows as Record<string, unknown>[],
    run: async (sql, params) => (await db.query(sql, params)).affectedRows ?? 0,
  });
  exec = async (text, values) => (await db.query(text, values)).rows as Record<string, unknown>[];
});

afterEach(async () => {
  setRemoteHarness(null);
  await db.close();
});

describe("listing state is per user", () => {
  it("A's favorite / hide / tags never reach B; updateTag targets A", async () => {
    authMock.mockResolvedValue(session(A, "admin"));
    await setListingStatusAction(form({ id: "1", status: "favorite" }));
    await setListingStatusAction(form({ id: "2", status: "hidden" }));
    await addUserTagAction(form({ id: "1", tag: "dream" }));
    await addUserTagAction(form({ id: "1", tag: "dream" })); // idempotent
    expect(updateTag).toHaveBeenCalledWith(`user-state:${A}`);
    expect(updateTag).not.toHaveBeenCalledWith(`user-state:${B}`);

    const a = await feed(A);
    expect(a.map((l) => l.id)).toEqual([1]); // 2 hidden
    expect(a[0]).toMatchObject({ status: "favorite", userTags: ["dream"] });

    const b = await feed(B);
    expect(b.map((l) => [l.id, l.status, l.userTags]).sort()).toEqual([[1, "new", []], [2, "new", []]]);
  });

  it("returning to 'new' with no tags deletes the row; removing the last tag too", async () => {
    authMock.mockResolvedValue(session(B, "user"));
    await setListingStatusAction(form({ id: "1", status: "applied" }));
    await addUserTagAction(form({ id: "1", tag: "t" }));
    await setListingStatusAction(form({ id: "1", status: "new" }));
    expect((await db.query("select * from user_listing_state")).rows).toHaveLength(1); // tag keeps it
    await removeUserTagAction(form({ id: "1", tag: "t" }));
    expect((await db.query("select * from user_listing_state")).rows).toHaveLength(0);
  });

  it("ignores unknown listing ids", async () => {
    authMock.mockResolvedValue(session(B, "user"));
    await setListingStatusAction(form({ id: "999", status: "favorite" }));
    expect((await db.query("select * from user_listing_state")).rows).toHaveLength(0);
  });
});

describe("follows, pins, settings are per user", () => {
  it("isolates follows and pins; both users may follow the same company", async () => {
    authMock.mockResolvedValue(session(A, "admin"));
    await toggleFollowCompanyAction(form({ company: "Acme" }));
    await togglePinCountryAction(form({ country: "Germany" }));
    authMock.mockResolvedValue(session(B, "user"));
    expect(await listFollowedCompanies(B)).toEqual([]);
    expect(await listPinnedCountries(B)).toEqual([]);
    await toggleFollowCompanyAction(form({ company: "acme" }));
    expect(await listFollowedCompanies(A)).toEqual(["Acme"]);
    expect(await listFollowedCompanies(B)).toEqual(["acme"]);
    await toggleFollowCompanyAction(form({ company: "ACME" })); // B unfollows only B's
    expect(await listFollowedCompanies(B)).toEqual([]);
    expect(await listFollowedCompanies(A)).toEqual(["Acme"]);
  });

  it("keywords/sound are per user; only an admin changes the refresh interval", async () => {
    authMock.mockResolvedValue(session(B, "user"));
    await saveSettingsAction(form({ global_keywords: "rust, go", interval_hours: "9" }));
    expect(await getGlobalKeywords(B)).toEqual(["rust", "go"]);
    expect(await isSoundEnabled(B)).toBe(false);
    expect(await getRefreshIntervalHours()).toBe(4); // non-admin ignored
    expect(await getGlobalKeywords(A)).toEqual([]);

    authMock.mockResolvedValue(session(A, "admin"));
    await saveSettingsAction(form({ global_keywords: "c", interval_hours: "9", sound_enabled: "on" }));
    expect(await getRefreshIntervalHours()).toBe(9);
    expect(await getGlobalKeywords(B)).toEqual(["rust", "go"]);
  });
});

describe("server-side authorization", () => {
  it("anonymous callers are rejected everywhere", async () => {
    authMock.mockResolvedValue(null);
    await setListingStatusAction(form({ id: "1", status: "favorite" }));
    await toggleFollowCompanyAction(form({ company: "Acme" }));
    await saveSettingsAction(form({ global_keywords: "x" }));
    await addBoardAction(form({ name: "N", type: "api", url: "http://n.example" }));
    expect((await db.query("select * from user_listing_state")).rows).toHaveLength(0);
    expect((await db.query("select * from followed_companies")).rows).toHaveLength(0);
    expect((await db.query("select * from user_settings")).rows).toHaveLength(0);
    expect((await db.query("select * from boards")).rows).toHaveLength(1);
    expect(await testBoardAction(1)).toEqual({ ok: false, message: "Sign in required" });
    expect(await createApiKeyAction({}, form({ name: "k" }))).toEqual({ error: "Sign in to create API keys." });
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("non-admins get 403 on board operations", async () => {
    authMock.mockResolvedValue(session(B, "user"));
    await addBoardAction(form({ name: "N", type: "api", url: "http://n.example" }));
    expect((await db.query("select * from boards")).rows).toHaveLength(1);
    expect(await testBoardAction(1)).toEqual({ ok: false, message: "Not allowed" });
  });

  it("admins can add boards", async () => {
    authMock.mockResolvedValue(session(A, "admin"));
    await addBoardAction(form({ name: "N", type: "api", url: "http://n.example" }));
    expect((await db.query("select * from boards")).rows).toHaveLength(2);
  });
});
