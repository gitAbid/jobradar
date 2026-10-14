import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setRemoteHarness } from "../src/db";
import { claimLegacyState } from "../src/lib/legacy-claim";

const mig = (f: string) => readFileSync(join(process.cwd(), "db/migrations", f), "utf8");
const FILES = ["001_baseline.sql", "002_feed_index.sql", "003_country.sql", "004_types.sql", "005_users.sql", "006_drop_global_state.sql"];

let db: PGlite;
afterEach(async () => {
  setRemoteHarness(null);
  await db.close();
});

async function setup() {
  db = new PGlite();
  for (const f of FILES.slice(0, 4)) await db.exec(mig(f));
  await db.exec(`
    insert into boards (name, type, url) values ('A','api','u');
    insert into listings (board_id, external_id, title, url, fetched_at, status, user_tags) values
      (1,'1','One','u','2026-09-01T00:00:00Z','favorite','[]'),
      (1,'2','Two','u','2026-09-01T00:00:00Z','new','["mine"]'),
      (1,'3','Three','u','2026-09-01T00:00:00Z','new','[]');
    insert into followed_companies (name, created_at) values ('Acme','2026-09-01T00:00:00Z');
    insert into pinned_countries (name, created_at) values ('Germany','2026-09-01T00:00:00Z');
    insert into api_keys (name, key_hash, prefix, created_at) values ('k','h','p','2026-09-01T00:00:00Z');
  `);
  await db.exec(mig(FILES[4]));
  await db.exec(mig(FILES[5]));
  setRemoteHarness({
    query: async (sql, params) => (await db.query(sql, params)).rows as Record<string, unknown>[],
    run: async (sql, params) => (await db.query(sql, params)).affectedRows ?? 0,
  });
  const a = await db.query<{ id: string }>("insert into users (email, role) values ('a@x.io','admin') returning id");
  const b = await db.query<{ id: string }>("insert into users (email) values ('b@x.io') returning id");
  return { admin: a.rows[0].id, other: b.rows[0].id };
}

describe("005_users migration + claimLegacyState", { timeout: 30000 }, () => {
  it("applies on seeded legacy rows; 006 preserves legacy state and drops the global columns", async () => {
    await setup();
    const cols = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name='listings' and column_name in ('status','user_tags')",
    );
    expect(cols.rows).toHaveLength(0);
    expect((await db.query("select listing_id, status, user_tags from legacy_listing_state order by listing_id")).rows).toEqual([
      { listing_id: 1, status: "favorite", user_tags: [] },
      { listing_id: 2, status: "new", user_tags: ["mine"] },
    ]);
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('users','accounts','user_listing_state','user_settings')",
    );
    expect(rls.rows).toHaveLength(4);
    expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true);
    expect((await db.query("select user_id from followed_companies")).rows[0]).toEqual({ user_id: null });
  });

  it("claims legacy state once, then is a no-op", async () => {
    const { admin, other } = await setup();
    await db.exec("insert into app_settings (key, value) values ('global_keywords', '[\"go\"]'), ('sound_enabled', 'false')");
    expect(await claimLegacyState(admin)).toBe(true);
    expect((await db.query("select key, value from user_settings where user_id=$1 order by key", [admin])).rows).toEqual([
      { key: "global_keywords", value: '["go"]' },
      { key: "sound_enabled", value: "false" },
    ]);
    const st = await db.query("select listing_id, status, user_tags from user_listing_state where user_id=$1 order by listing_id", [admin]);
    expect(st.rows).toEqual([
      { listing_id: 1, status: "favorite", user_tags: [] },
      { listing_id: 2, status: "new", user_tags: ["mine"] },
    ]);
    for (const t of ["followed_companies", "pinned_countries", "api_keys"])
      expect((await db.query(`select user_id from ${t}`)).rows).toEqual([{ user_id: admin }]);
    const marker = await db.query<{ value: string }>("select value from app_settings where key='legacy_claimed'");
    const parsed = JSON.parse(marker.rows[0].value);
    expect(parsed.userId).toBe(admin);
    expect(Number.isNaN(Date.parse(parsed.claimedAt))).toBe(false);

    // New unowned rows after the claim, and a second caller: nothing changes.
    await db.exec("insert into followed_companies (name, created_at) values ('Late','2026-09-02T00:00:00Z')");
    expect(await claimLegacyState(other)).toBe(false);
    expect((await db.query("select count(*)::int as n from user_listing_state")).rows[0]).toEqual({ n: 2 });
    expect((await db.query("select user_id from followed_companies where name='Late'")).rows[0]).toEqual({ user_id: null });
    expect((await db.query("select count(*)::int as n from app_settings where key='legacy_claimed'")).rows[0]).toEqual({ n: 1 });
  });

  it("lets two users follow the same company, but not one user twice", async () => {
    const { admin, other } = await setup();
    await db.query("insert into followed_companies (name, created_at, user_id) values ('Zed', now(), $1), ('zed', now(), $2)", [admin, other]);
    await expect(
      db.query("insert into followed_companies (name, created_at, user_id) values ('ZED', now(), $1)", [admin]),
    ).rejects.toThrow();
  });

  it("cascades user deletion", async () => {
    const { admin } = await setup();
    await claimLegacyState(admin);
    await db.query("insert into accounts (provider, provider_account_id, user_id) values ('github','1',$1)", [admin]);
    await db.query("insert into user_settings (user_id, key, value) values ($1,'k','v')", [admin]);
    await db.query("delete from users where id=$1", [admin]);
    for (const t of ["user_listing_state", "accounts", "user_settings", "followed_companies", "pinned_countries", "api_keys"])
      expect((await db.query(`select count(*)::int as n from ${t}`)).rows[0]).toEqual({ n: 0 });
  });
});

describe("006_drop_global_state + claimLegacyState", { timeout: 30000 }, () => {
  it("skips legacy rows whose listing was deleted before the claim", async () => {
    const { admin } = await setup();
    await db.exec("delete from listings where id = 1");
    expect(await claimLegacyState(admin)).toBe(true);
    expect((await db.query("select listing_id from user_listing_state")).rows).toEqual([{ listing_id: 2 }]);
  });
});
