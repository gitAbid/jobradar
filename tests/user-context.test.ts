import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { listFollowedCompanies, listPinnedCountries, setRemoteHarness } from "@/db";
import { getGlobalKeywords, getTheme, isSoundEnabled, needsOnboarding, setUserSetting } from "@/lib/settings";
import {
  contextGlobalKeywords,
  contextNeedsOnboarding,
  contextSoundEnabled,
  contextTheme,
  loadUserContext,
} from "@/lib/user-context";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  for (const f of readdirSync(join(process.cwd(), "db/migrations")).sort())
    if (f.endsWith(".sql")) await db.exec(readFileSync(join(process.cwd(), "db/migrations", f), "utf8"));
  await db.query("insert into users (id, email, role) values ($1,'a@x.io','user'), ($2,'b@x.io','user')", [A, B]);
  setRemoteHarness({
    query: async (sql, params) => (await db.query(sql, params)).rows as Record<string, unknown>[],
    run: async (sql, params) => (await db.query(sql, params)).affectedRows ?? 0,
  });
});

/** The one-query context must agree with every per-field helper it replaces. */
async function expectParity(userId: string) {
  const ctx = await loadUserContext(userId);
  expect(contextNeedsOnboarding(ctx)).toBe(await needsOnboarding(userId));
  expect(contextGlobalKeywords(ctx)).toEqual(await getGlobalKeywords(userId));
  expect(contextSoundEnabled(ctx)).toBe(await isSoundEnabled(userId));
  expect(contextTheme(ctx)).toBe(await getTheme(userId));
  expect(ctx.pinnedCountries).toEqual(await listPinnedCountries(userId));
  expect(ctx.followedCompanies).toEqual(await listFollowedCompanies(userId));
  return ctx;
}

describe("user context", () => {
  it("brand-new user: defaults and needs onboarding", async () => {
    const ctx = await expectParity(A);
    expect(contextNeedsOnboarding(ctx)).toBe(true);
    expect(contextTheme(ctx)).toBe("system");
    expect(contextSoundEnabled(ctx)).toBe(true);
    expect(contextGlobalKeywords(ctx)).toEqual([]);
  });

  it("reads settings, pins and follows for the caller only, sorted case-insensitively", async () => {
    await setUserSetting(A, "global_keywords", JSON.stringify(["Java", "Spring Boot"]));
    await setUserSetting(A, "theme", "dark");
    await setUserSetting(A, "sound_enabled", "false");
    for (const name of ["germany", "Canada", "Bangladesh"])
      await db.query("insert into pinned_countries (name, created_at, user_id) values ($1, now(), $2)", [name, A]);
    for (const name of ["zeta", "Acme"])
      await db.query("insert into followed_companies (name, created_at, user_id) values ($1, now(), $2)", [name, A]);
    await db.query("insert into pinned_countries (name, created_at, user_id) values ('Japan', now(), $1)", [B]);

    const ctx = await expectParity(A);
    expect(ctx.pinnedCountries).toEqual(["Bangladesh", "Canada", "germany"]);
    expect(ctx.followedCompanies).toEqual(["Acme", "zeta"]);
    expect(contextGlobalKeywords(ctx)).toEqual(["Java", "Spring Boot"]);
    expect(contextTheme(ctx)).toBe("dark");
    expect(contextSoundEnabled(ctx)).toBe(false);

    const other = await expectParity(B);
    expect(other.pinnedCountries).toEqual(["Japan"]);
    expect(other.followedCompanies).toEqual([]);
  });

  it("any single kind of prior state skips onboarding", async () => {
    await db.exec(`
      insert into boards (name, type, url) values ('Bd','api','http://x');
      insert into listings (board_id, external_id, title, company, url, fetched_at)
        values (1, 'e1', 'T', 'C', 'http://x/1', 'now');`);
    await db.query("insert into user_listing_state (user_id, listing_id, status) values ($1, 1, 'favorite')", [A]);
    expect(contextNeedsOnboarding(await expectParity(A))).toBe(false);

    await db.query("insert into followed_companies (name, created_at, user_id) values ('Acme', now(), $1)", [B]);
    expect(contextNeedsOnboarding(await expectParity(B))).toBe(false);
  });

  it("malformed keyword JSON falls back like the helper", async () => {
    await setUserSetting(A, "global_keywords", "{not json");
    expect(contextGlobalKeywords(await expectParity(A))).toEqual([]);
  });
});
