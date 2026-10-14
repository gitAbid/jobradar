import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { globSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const authMock = vi.fn();
const signOutMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock(), signOut: (...a: unknown[]) => signOutMock(...a) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));
class Redirect extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}
class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
  notFound: () => {
    throw new NotFound("notFound");
  },
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => {},
  after: vi.fn(),
}));
const refreshBoard = vi.fn(async () => ({ ok: true, fetched: 0, inserted: 0 }));
vi.mock("@/lib/refresh", () => ({
  refreshBoard: (...a: unknown[]) => (refreshBoard as (...x: unknown[]) => unknown)(...a),
  startRefreshRun: vi.fn(async () => null),
}));
const readCurrentRun = vi.fn(async () => ({ id: "r1" }));
vi.mock("@/lib/refresh-run-store", () => ({ readCurrentRun: () => readCurrentRun() }));

import { setRemoteHarness } from "@/db";
import * as publicActions from "@/app/actions";
import * as keyActions from "@/app/settings/api-keys/actions";
import * as accountActions from "@/app/settings/account/actions";
import { GET as exportGET } from "@/app/api/account/export/route";
import { requirePageAdmin, requirePageUser } from "@/lib/authz";
import { POST as refreshPOST } from "@/app/api/refresh/route";
import { GET as statusGET } from "@/app/api/refresh/status/route";
import { GET as cronGET } from "@/app/api/refresh/cron/route";
import { GET as metaGET } from "@/app/api/v1/meta/route";
import { GET as jobsGET } from "@/app/api/v1/jobs/route";
import { GET as jobGET } from "@/app/api/v1/jobs/[id]/route";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const session = (id: string | null, role: "admin" | "user") =>
  id ? { user: { id, email: `${id.slice(-2)}@x.io`, role } } : null;
const asAnon = () => authMock.mockResolvedValue(null);
const asA = () => authMock.mockResolvedValue(session(A, "user"));
const asAdmin = () => authMock.mockResolvedValue(session(ADMIN, "admin"));

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

let db: PGlite;
const TABLES = [
  "boards",
  "listings",
  "user_listing_state",
  "followed_companies",
  "pinned_countries",
  "user_settings",
  "app_settings",
  "api_keys",
  "users",
];
/** Full content of every user-owned/system table, for before/after comparison. */
async function snapshot(): Promise<string> {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) out[t] = (await db.query(`select * from ${t} order by 1, 2`)).rows;
  return JSON.stringify(out);
}
async function rowsFor(table: string, userId: string): Promise<string> {
  return JSON.stringify((await db.query(`select * from ${table} where user_id = $1 order by 1, 2`, [userId])).rows);
}

beforeEach(async () => {
  authMock.mockReset();
  refreshBoard.mockClear();
  readCurrentRun.mockClear();
  db = new PGlite();
  const dir = join(process.cwd(), "db/migrations");
  for (const f of readdirSync(dir).sort()) if (f.endsWith(".sql")) await db.exec(readFileSync(join(dir, f), "utf8"));
  await db.query(
    "insert into users (id, email, role) values ($1,'a@x.io','user'), ($2,'b@x.io','user'), ($3,'ad@x.io','admin')",
    [A, B, ADMIN],
  );
  await db.exec(`
    insert into boards (name, type, url) values ('Bd','api','http://x');
    insert into listings (board_id, external_id, title, company, url, fetched_at)
      values (1,'1','One','Acme','u', now()), (1,'2','Two','Beta','u', now());
    insert into app_settings (key, value) values ('refresh_interval_hours','4');
  `);
  // B owns state of every kind
  await db.query("insert into user_listing_state (user_id, listing_id, status, user_tags) values ($1,1,'favorite','[\"keep\"]'::jsonb)", [B]);
  await db.query("insert into followed_companies (user_id, name, created_at) values ($1,'Acme', now())", [B]);
  await db.query("insert into pinned_countries (user_id, name, created_at) values ($1,'Canada', now())", [B]);
  await db.query("insert into user_settings (user_id, key, value) values ($1,'sound_enabled','true'), ($1,'global_keywords','[\"b-kw\"]')", [B]);
  await db.query("insert into api_keys (name, key_hash, prefix, user_id, created_at) values ('bk','hash-b','jr_b',$1, now())", [B]);
  setRemoteHarness({
    query: async (sql, params) => (await db.query(sql, params)).rows as Record<string, unknown>[],
    run: async (sql, params) => (await db.query(sql, params)).affectedRows ?? 0,
  });
});

afterEach(async () => {
  setRemoteHarness(null);
  await db.close();
});

// ── Server actions ─────────────────────────────────────────────────────────

type Call = () => Promise<unknown>;
interface ActionCase {
  admin: boolean;
  call: Call;
}
const BOARD_FORM = { id: "1", name: "New", type: "api", url: "https://new.example.com", keywords: "a,b" };

/** One entry per exported action; adding an export without a case fails "covers every export". */
const ACTIONS: Record<string, ActionCase> = {
  addBoardAction: { admin: true, call: () => publicActions.addBoardAction(form(BOARD_FORM)) },
  updateBoardKeywordsAction: { admin: true, call: () => publicActions.updateBoardKeywordsAction(form({ id: "1", keywords: "zzz" })) },
  toggleBoardEnabledAction: { admin: true, call: () => publicActions.toggleBoardEnabledAction(form({ id: "1" })) },
  deleteBoardAction: { admin: true, call: () => publicActions.deleteBoardAction(form({ id: "1" })) },
  testBoardAction: { admin: true, call: () => publicActions.testBoardAction(1) },
  setListingStatusAction: { admin: false, call: () => publicActions.setListingStatusAction(form({ id: "2", status: "applied" })) },
  addUserTagAction: { admin: false, call: () => publicActions.addUserTagAction(form({ id: "2", tag: "t" })) },
  removeUserTagAction: { admin: false, call: () => publicActions.removeUserTagAction(form({ id: "1", tag: "keep" })) },
  toggleFollowCompanyAction: { admin: false, call: () => publicActions.toggleFollowCompanyAction(form({ company: "Acme" })) },
  togglePinCountryAction: { admin: false, call: () => publicActions.togglePinCountryAction(form({ country: "Canada" })) },
  saveSettingsAction: {
    admin: false,
    call: () => publicActions.saveSettingsAction(form({ global_keywords: "x,y", sound_enabled: "off", interval_hours: "9" })),
  },
  saveThemeAction: { admin: false, call: () => publicActions.saveThemeAction(form({ theme: "dark" })) },
  createApiKeyAction: { admin: false, call: () => keyActions.createApiKeyAction({}, form({ name: "mine" })) },
  revokeApiKeyAction: { admin: false, call: () => keyActions.revokeApiKeyAction(form({ id: "1" })) },
  deleteAccountAction: { admin: false, call: () => accountActions.deleteAccountAction() },
};

describe("authz matrix: coverage", () => {
  it("covers every exported server action", () => {
    const exported = [
      ...Object.keys(publicActions),
      ...Object.keys(keyActions),
      ...Object.keys(accountActions),
    ]
      .filter((k) => [publicActions, keyActions, accountActions].some((m) => typeof (m as Record<string, unknown>)[k] === "function"))
      .sort();
    expect(Object.keys(ACTIONS).sort()).toEqual(exported);
  });

  // Every /api route self-authenticates (the proxy lets /api/* through), so each
  // route file must be listed either here with its mechanism or in the matrix below.
  const ROUTE_AUTH: Record<string, "admin" | "cron-secret" | "api-key" | "public" | "authjs" | "session"> = {
    "src/app/api/refresh/route.ts": "admin",
    "src/app/api/refresh/status/route.ts": "admin",
    "src/app/api/refresh/cron/route.ts": "cron-secret",
    "src/app/api/v1/meta/route.ts": "api-key",
    "src/app/api/v1/jobs/route.ts": "api-key",
    "src/app/api/v1/jobs/[id]/route.ts": "api-key",
    "src/app/api/health/route.ts": "public",
    "src/app/api/account/export/route.ts": "session",
    "src/app/api/auth/[...nextauth]/route.ts": "authjs",
  };

  it("classifies every route.ts file", () => {
    const routes = globSync("src/app/api/**/route.ts", { cwd: process.cwd() }).sort();
    expect(Object.keys(ROUTE_AUTH).sort()).toEqual(routes);
  });
});

describe("authz matrix: server actions", () => {
  for (const [name, c] of Object.entries(ACTIONS)) {
    it(`${name}: anonymous mutates nothing`, async () => {
      asAnon();
      const before = await snapshot();
      await c.call();
      expect(await snapshot()).toBe(before);
      expect(refreshBoard).not.toHaveBeenCalled();
    });

    if (c.admin) {
      it(`${name}: non-admin mutates nothing`, async () => {
        asA();
        const before = await snapshot();
        await c.call();
        expect(await snapshot()).toBe(before);
        expect(refreshBoard).not.toHaveBeenCalled();
      });
      it(`${name}: admin succeeds`, async () => {
        asAdmin();
        const before = await snapshot();
        await c.call();
        if (name === "testBoardAction") expect(refreshBoard).toHaveBeenCalled();
        else expect(await snapshot()).not.toBe(before);
      });
    }
  }

  it("anonymous/non-admin testBoardAction and createApiKeyAction report an error and leak nothing", async () => {
    asAnon();
    expect(await publicActions.testBoardAction(1)).toEqual({ ok: false, message: "Sign in required" });
    expect(await keyActions.createApiKeyAction({}, form({ name: "x" }))).toMatchObject({ error: expect.any(String) });
    asA();
    expect(await publicActions.testBoardAction(1)).toEqual({ ok: false, message: "Not allowed" });
  });
});

describe("authz matrix: cross-user isolation (A acts, B's rows untouched)", () => {
  const BTABLES = ["user_listing_state", "followed_companies", "pinned_countries", "user_settings", "api_keys"];
  const bSnapshot = async () => JSON.stringify(await Promise.all(BTABLES.map((t) => rowsFor(t, B))));

  it("A's user-scoped actions, including with B's ids/names, leave B unchanged", async () => {
    asA();
    const before = await bSnapshot();
    await publicActions.setListingStatusAction(form({ id: "1", status: "hidden" })); // B's listing state row
    await publicActions.addUserTagAction(form({ id: "1", tag: "intruder" }));
    await publicActions.removeUserTagAction(form({ id: "1", tag: "keep" }));
    await publicActions.toggleFollowCompanyAction(form({ company: "Acme" }));
    await publicActions.togglePinCountryAction(form({ country: "Canada" }));
    await publicActions.saveSettingsAction(form({ global_keywords: "a-kw", sound_enabled: "off" }));
    await keyActions.revokeApiKeyAction(form({ id: "1" })); // B's key id
    expect(await bSnapshot()).toBe(before);
    // A's own writes did land under A
    expect((await db.query("select 1 from followed_companies where user_id=$1", [A])).rows).toHaveLength(1);
    expect((await db.query("select 1 from user_listing_state where user_id=$1", [A])).rows).toHaveLength(1);
  });

  it("A cannot see B's API keys in the key store listing", async () => {
    const { apiKeys } = await import("@/lib/api/keys-store");
    expect(await apiKeys().list(A)).toEqual([]);
    expect(await apiKeys().list(B)).toHaveLength(1);
  });

  it("B can revoke their own key (control)", async () => {
    authMock.mockResolvedValue(session(B, "user"));
    await keyActions.revokeApiKeyAction(form({ id: "1" }));
    const r = await db.query("select revoked_at from api_keys where user_id=$1", [B]);
    expect((r.rows[0] as { revoked_at: unknown }).revoked_at).not.toBeNull();
  });

  it("non-admin saveSettingsAction cannot change the system refresh interval; admin can", async () => {
    asA();
    await publicActions.saveSettingsAction(form({ interval_hours: "9" }));
    expect((await db.query("select value from app_settings where key='refresh_interval_hours'")).rows[0]).toEqual({ value: "4" });
    asAdmin();
    await publicActions.saveSettingsAction(form({ interval_hours: "9" }));
    expect((await db.query("select value from app_settings where key='refresh_interval_hours'")).rows[0]).toEqual({ value: "9" });
  });
});

// ── Routes ─────────────────────────────────────────────────────────────────

describe("authz matrix: routes", () => {
  const post = () => refreshPOST(new Request("https://x.io/api/refresh", { method: "POST" }));

  it("/api/refresh POST and /api/refresh/status GET: 401 anonymous, 403 non-admin", async () => {
    asAnon();
    for (const res of [await post(), await statusGET()]) expect(res.status).toBe(401);
    asA();
    for (const res of [await post(), await statusGET()]) expect(res.status).toBe(403);
    expect(readCurrentRun).not.toHaveBeenCalled();
  });

  it("/api/account/export: 401 anonymous, 200 for a session", async () => {
    asAnon();
    expect((await exportGET()).status).toBe(401);
    asA();
    expect((await exportGET()).status).toBe(200);
  });

  it("/api/refresh/status: admin allowed", async () => {
    asAdmin();
    expect((await statusGET()).status).toBe(200);
  });

  it("/api/refresh/cron: rejects missing/wrong secret and session cookies alone", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    try {
      asAdmin(); // a logged-in admin session is not a cron credential
      expect((await cronGET(new Request("https://x.io/api/refresh/cron"))).status).toBe(401);
      const bad = new Request("https://x.io/api/refresh/cron", { headers: { authorization: "Bearer nope" } });
      expect((await cronGET(bad)).status).toBe(401);
      vi.stubEnv("CRON_SECRET", "");
      const unset = new Request("https://x.io/api/refresh/cron", { headers: { authorization: "Bearer " } });
      expect((await cronGET(unset)).status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("/api/v1/*: 401 without a key, 401 with an unknown key, regardless of web session", async () => {
    asAdmin();
    const url = "https://x.io/api/v1/";
    const ctx = { params: Promise.resolve({ id: "1" }) };
    for (const headers of [{} as Record<string, string>, { authorization: "Bearer jr_unknown" }, { "x-api-key": "jr_unknown" }]) {
      const rs = [
        await metaGET(new Request(`${url}meta`, { headers })),
        await jobsGET(new Request(`${url}jobs`, { headers })),
        await jobGET(new Request(`${url}jobs/1`, { headers }), ctx),
      ];
      for (const r of rs) expect(r.status).toBe(401);
    }
  });
});

// ── Page helpers ───────────────────────────────────────────────────────────

describe("authz matrix: page guards", () => {
  it("requirePageUser redirects anonymous to /signin", async () => {
    asAnon();
    await expect(requirePageUser()).rejects.toMatchObject({ to: "/signin" });
    asA();
    expect((await requirePageUser()).id).toBe(A);
  });

  it("requirePageAdmin: anonymous → /signin, non-admin → notFound, admin passes", async () => {
    asAnon();
    await expect(requirePageAdmin()).rejects.toMatchObject({ to: "/signin" });
    asA();
    await expect(requirePageAdmin()).rejects.toBeInstanceOf(NotFound);
    asAdmin();
    expect((await requirePageAdmin()).role).toBe("admin");
  });
});
