import { beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { listPinnedCountries, setRemoteHarness } from "@/db";
import { completeOnboardingAction, skipOnboardingAction } from "@/app/onboarding/actions";
import { getGlobalKeywords, getUserSetting, needsOnboarding, setUserSetting } from "@/lib/settings";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
let db: PGlite;

const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const hrefOf = async (p: ReturnType<typeof skipOnboardingAction>) => {
  const r = await p;
  return r?.ok ? r.href : null;
};

beforeEach(async () => {
  authMock.mockReset();
  db = new PGlite();
  for (const f of readdirSync(join(process.cwd(), "db/migrations")).sort())
    if (f.endsWith(".sql")) await db.exec(readFileSync(join(process.cwd(), "db/migrations", f), "utf8"));
  await db.query("insert into users (id, email, role) values ($1,'a@x.io','user'), ($2,'b@x.io','user')", [A, B]);
  setRemoteHarness({
    query: async (sql, params) => (await db.query(sql, params)).rows as Record<string, unknown>[],
    run: async (sql, params) => (await db.query(sql, params)).affectedRows ?? 0,
  });
  authMock.mockResolvedValue({ user: { id: A, email: "a@x.io", role: "user" } });
});

describe("onboarding", () => {
  it("anonymous writes nothing", async () => {
    authMock.mockResolvedValue(null);
    expect(await completeOnboardingAction(null, form({ keywords: "java" }))).toEqual({ ok: false, error: "Sign in required" });
    expect(await skipOnboardingAction()).toEqual({ ok: false, error: "Sign in required" });
    expect((await db.query("select 1 from user_settings")).rows).toHaveLength(0);
  });

  it("saves keywords, pinned countries and the marker for the caller only", async () => {
    const to = await hrefOf(completeOnboardingAction(null, form({ keywords: "Java, Spring Boot, java", country: ["Canada", "Germany"] })));
    expect(to).toBe("/?country=Canada&country=Germany");
    expect(await getGlobalKeywords(A)).toEqual(["Java", "Spring Boot"]);
    expect(await listPinnedCountries(A)).toEqual(["Canada", "Germany"]);
    expect(await getUserSetting(A, "onboarding_complete")).toBe("true");
    expect(await needsOnboarding(A)).toBe(false);
    expect(await getGlobalKeywords(B)).toEqual([]);
    expect(await needsOnboarding(B)).toBe(true);
  });

  it("rejects an empty submission", async () => {
    const r = await completeOnboardingAction(null, form({ keywords: " , " }));
    expect(r?.ok).toBe(false);
    expect(await needsOnboarding(A)).toBe(true);
  });

  it("skip marks complete without preferences", async () => {
    expect(await hrefOf(skipOnboardingAction())).toBe("/");
    expect(await needsOnboarding(A)).toBe(false);
    expect(await getGlobalKeywords(A)).toEqual([]);
  });

  it("existing users with any state are not forced through onboarding", async () => {
    await setUserSetting(B, "sound_enabled", "true");
    expect(await needsOnboarding(B)).toBe(false);
  });
});
