import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const authMock = vi.fn();
const signOutMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock(), signOut: (...a: unknown[]) => signOutMock(...a) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

import { setRemoteHarness } from "@/db";
import { deleteAccountAction } from "@/app/settings/account/actions";
import { GET } from "@/app/api/account/export/route";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const as = (id: string | null) =>
  authMock.mockResolvedValue(id ? { user: { id, email: `${id.slice(-2)}@x.io`, role: "user" } } : null);

let db: PGlite;
const owned = ["user_listing_state", "followed_companies", "pinned_countries", "user_settings", "api_keys", "accounts"];
const count = async (t: string, id: string) =>
  (await db.query(`select 1 from ${t} where user_id = $1`, [id])).rows.length;

beforeEach(async () => {
  authMock.mockReset();
  signOutMock.mockReset();
  db = new PGlite();
  const dir = join(process.cwd(), "db/migrations");
  for (const f of readdirSync(dir).sort()) if (f.endsWith(".sql")) await db.exec(readFileSync(join(dir, f), "utf8"));
  await db.exec(`
    insert into users (id, email, name) values ('${A}','a@x.io','Ann'), ('${B}','b@x.io','Bob');
    insert into boards (name, type, url) values ('Bd','api','http://x');
    insert into listings (board_id, external_id, title, company, url, fetched_at) values (1,'1','One','Acme','http://u/1', now());
  `);
  for (const [id, n] of [[A, "a"], [B, "b"]]) {
    await db.query("insert into user_listing_state (user_id, listing_id, status, user_tags) values ($1,1,'favorite','[\"t\"]'::jsonb)", [id]);
    await db.query("insert into followed_companies (user_id, name, created_at) values ($1,'Acme', now())", [id]);
    await db.query("insert into pinned_countries (user_id, name, created_at) values ($1,'Canada', now())", [id]);
    await db.query("insert into user_settings (user_id, key, value) values ($1,'sound_enabled','true')", [id]);
    await db.query("insert into accounts (provider, provider_account_id, user_id) values ('github',$2,$1)", [id, n]);
    await db.query("insert into api_keys (name, key_hash, prefix, user_id, created_at) values ($2,$3,$4,$1, now())", [id, `Key ${n}`, `hash-${n}-secret`, `jr_${n}`]);
  }
  await db.exec("insert into api_rate (key_id, window_start, count) select id, now(), 1 from api_keys");
  setRemoteHarness({
    query: async (sql, params) => (await db.query(sql, params)).rows as Record<string, unknown>[],
    run: async (sql, params) => (await db.query(sql, params)).affectedRows ?? 0,
  });
});

afterEach(async () => {
  setRemoteHarness(null);
  await db.close();
});

describe("deleteAccountAction", () => {
  it("removes only the caller's rows, then signs out to /", async () => {
    as(A);
    await deleteAccountAction();
    expect((await db.query("select 1 from users where id=$1", [A])).rows).toHaveLength(0);
    for (const t of owned) {
      expect(await count(t, A), t).toBe(0);
      expect(await count(t, B), t).toBe(1);
    }
    expect((await db.query("select 1 from api_rate")).rows).toHaveLength(1);
    expect((await db.query("select 1 from users where id=$1", [B])).rows).toHaveLength(1);
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: "/" });
  });

  it("does nothing when signed out", async () => {
    as(null);
    expect(await deleteAccountAction()).toMatchObject({ ok: false });
    expect((await db.query("select 1 from users")).rows).toHaveLength(2);
    expect(signOutMock).not.toHaveBeenCalled();
  });
});

describe("account export", () => {
  it("401 when anonymous", async () => {
    as(null);
    expect((await GET()).status).toBe(401);
  });

  it("returns only the caller's data, no key hashes", async () => {
    as(A);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="jobradar-export.json"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain("hash-a-secret");
    expect(text).not.toContain("key_hash");
    expect(text).not.toContain("b@x.io");
    expect(text).not.toContain("jr_b");
    const body = JSON.parse(text);
    expect(body.profile).toMatchObject({ email: "a@x.io", name: "Ann" });
    expect(body.settings).toEqual({ sound_enabled: "true" });
    expect(body.listingStates).toEqual([
      expect.objectContaining({ status: "favorite", tags: ["t"], title: "One", company: "Acme", url: "http://u/1" }),
    ]);
    expect(body.followedCompanies).toEqual(["Acme"]);
    expect(body.pinnedCountries).toEqual(["Canada"]);
    expect(body.apiKeys).toHaveLength(1);
    expect(Object.keys(body.apiKeys[0]).sort()).toEqual(["created_at", "last_used_at", "name", "prefix", "revoked_at"]);
  });
});
