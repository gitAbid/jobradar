import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  dbStatus,
  q,
  qOne,
  resetLocalFirstForTests,
  run,
  setRemoteHarness,
  insertListings,
  type RemoteHarness,
} from "@/db";
import { classifyRemoteError, translateToSqlite } from "@/db/translate";
import { getLocalStore } from "@/db/local-store";
import { resetBreakerForTests } from "@/db/remote-health";
import { drainOutbox, hydrateFromRemote } from "@/db/sync";

// ── fake remote ────────────────────────────────────────────────────────────

const CONN_FAIL = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
  code: "ECONNREFUSED",
});

const downHarness: RemoteHarness = {
  query: async () => {
    throw CONN_FAIL;
  },
  run: async () => {
    throw CONN_FAIL;
  },
};

interface FakeRemote {
  harness: RemoteHarness;
  runCalls: Array<{ sql: string; params: unknown[] }>;
}

/** Healthy fake remote: canned snapshot pulls + id resolution + run recorder. */
function makeHealthy(snap: {
  boards?: Record<string, unknown>[];
  listings?: Record<string, unknown>[];
  settings?: Array<{ key: string; value: string }>;
}): FakeRemote {
  const boards = snap.boards ?? [];
  const listings = snap.listings ?? [];
  const runCalls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    runCalls,
    harness: {
      query: async (sql, params) => {
        const s = sql.toLowerCase();
        if (s.includes("from boards") && s.includes("select *")) return boards;
        if (s.includes("from listings") && s.includes("select *")) return listings;
        if (s.includes("from app_settings")) return snap.settings ?? [];
        if (s.includes("from followed_companies")) return [];
        if (s.includes("from pinned_countries")) return [];
        if (s.includes("from api_keys")) return [];
        if (s.includes("select id from boards where name")) {
          return boards.filter((b) => b.name === params[0]).map((b) => ({ id: b.id }));
        }
        if (s.includes("select id from listings where board_id")) {
          return listings
            .filter((l) => l.board_id === params[0] && l.external_id === params[1])
            .map((l) => ({ id: l.id }));
        }
        if (s.includes("select id from api_keys where key_hash")) return [];
        return [];
      },
      run: async (sql, params) => {
        runCalls.push({ sql, params });
        return 1;
      },
    },
  };
}

const BOARD = {
  id: 1,
  name: "RemoteOK",
  type: "api",
  url: "https://remoteok.com/api",
  enabled: 1,
  filter_keywords: '["java"]',
  last_fetched_at: null,
  last_status: null,
  fetch_interval_hours: 4,
};

const LISTING = {
  id: 11,
  board_id: 1,
  external_id: "r1",
  title: "Senior Java Engineer",
  company: "Acme",
  location: "Remote",
  is_remote: 1,
  visa_sponsorship: 0,
  remote_scope: null,
  tags: "[]",
  skills: "[]",
  url: "https://example.com/1",
  posted_at: null,
  deadline: null,
  fetched_at: "2026-09-15T00:00:00.000Z",
  status: "new",
  user_tags: "[]",
  search_text: "senior java engineer",
  description: "",
};

// ── per-test sandbox ───────────────────────────────────────────────────────

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "jobradar-localdb-"));
  process.env.LOCAL_DB_PATH = path.join(dir, "local.db");
  process.env.DATABASE_URL = "postgres://harness:test@localhost:5432/db";
});

afterEach(async () => {
  await resetLocalFirstForTests();
  setRemoteHarness(null);
  delete process.env.LOCAL_DB_PATH;
  delete process.env.LOCAL_FIRST;
  delete process.env.DATABASE_URL;
  rmSync(dir, { recursive: true, force: true });
});

// ── translation ────────────────────────────────────────────────────────────

describe("translateToSqlite", () => {
  it("expands repeated params and strips casts", () => {
    const t = translateToSqlite("select b.* from boards b where ($1::int is null or b.id = $1)", [5]);
    expect(t.sql).toBe("select b.* from boards b where (? is null or b.id = ?)");
    expect(t.params).toEqual([5, 5]);
    expect(t.skipLocal).toBe(false);
  });

  it("marks Postgres-only statements skipLocal", () => {
    expect(translateToSqlite("alter table listings enable row level security").skipLocal).toBe(true);
    expect(
      translateToSqlite("select * from unnest($1::text[], $2::text[])").skipLocal,
    ).toBe(true);
    expect(
      translateToSqlite("create table if not exists api_keys (id integer primary key)").skipLocal,
    ).toBe(true);
  });

  it("coerces undefined params to null", () => {
    expect(translateToSqlite("select 1 where a = $1", [undefined]).params).toEqual([null]);
  });
});

describe("classifyRemoteError", () => {
  it("buckets connection, limit and query errors", () => {
    expect(classifyRemoteError(new Error("Connection terminated unexpectedly"))).toBe("connection");
    expect(classifyRemoteError(new Error("Too many connections already open"))).toBe("limit");
    expect(classifyRemoteError(new Error("compute quota exceeded for project"))).toBe("limit");
    expect(classifyRemoteError(new Error('syntax error at or near "form"'))).toBe("query");
  });

  it("treats postgres driver CONNECT_TIMEOUT (uppercase code + errno) as connection", () => {
    const err = Object.assign(
      new Error(
        "write CONNECT_TIMEOUT ep-round-king-aetztw9u-pooler.c-2.us-east-2.aws.neon.tech:5432",
      ),
      { code: "CONNECT_TIMEOUT", errno: "CONNECT_TIMEOUT", port: 5432 },
    );
    expect(classifyRemoteError(err)).toBe("connection");
  });

  it("treats uppercase Node connection codes as connection errors", () => {
    const econnrefused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    expect(classifyRemoteError(econnrefused)).toBe("connection");
    const etimedout = Object.assign(new Error("connection ETIMEDOUT"), { code: "ETIMEDOUT" });
    expect(classifyRemoteError(etimedout)).toBe("connection");
  });
});

// ── fallback behavior ──────────────────────────────────────────────────────

describe("offline fallback", () => {
  it("writes locally and queues for sync when the remote is down", async () => {
    setRemoteHarness(downHarness);
    const store = await getLocalStore();
    expect(store).not.toBeNull();

    const n = await run(
      "insert into app_settings (key, value) values ($1, $2) " +
        "on conflict (key) do update set value = excluded.value",
      ["global_keywords", '["java"]'],
    );
    expect(n).toBe(1);
    expect(store!.queueDepth()).toBe(1);

    // reads come from the on-device store
    const row = await qOne<{ value: string }>("select value from app_settings where key = $1", [
      "global_keywords",
    ]);
    expect(row?.value).toBe('["java"]');

    const status = await dbStatus();
    expect(status.mode).toBe("local-first");
    expect(status.remote).toBe("down");
    expect(status.queueDepth).toBe(1);
  });

  it("serves empty reads on a fresh offline store instead of crashing", async () => {
    setRemoteHarness(downHarness);
    const rows = await q("select * from listings");
    expect(rows).toEqual([]);
  });

  it("seeds default boards when the remote is not configured", async () => {
    delete process.env.DATABASE_URL;
    await getLocalStore();
    const boards = await q("select * from boards order by name");
    expect(boards.length).toBeGreaterThan(5);
    expect(boards.every((b) => typeof b.name === "string")).toBe(true);
  });

  it("LOCAL_FIRST=0 restores remote-direct mode", async () => {
    process.env.LOCAL_FIRST = "0";
    await resetLocalFirstForTests();
    expect(await getLocalStore()).toBeNull();
    const status = await dbStatus();
    expect(status.mode).toBe("remote-direct");
  });
});

// ── hydration ──────────────────────────────────────────────────────────────

describe("hydration", () => {
  it("pulls the remote snapshot and preserves ids", async () => {
    const fake = makeHealthy({ boards: [BOARD], listings: [LISTING] });
    setRemoteHarness(fake.harness);
    expect(await hydrateFromRemote("test")).toBe(true);

    const rows = await q(
      `select l.*, b.name as board_name, b.filter_keywords as board_filter_keywords
       from listings l join boards b on b.id = l.board_id`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(11);
    expect(rows[0].board_name).toBe("RemoteOK");

    const status = await dbStatus();
    expect(status.local.listings).toBe(1);
    expect(status.local.lastHydratedAt).not.toBeNull();
  });

  it("keeps locally-added settings on merge", async () => {
    setRemoteHarness(downHarness);
    await run(
      "insert into app_settings (key, value) values ($1, $2) " +
        "on conflict (key) do update set value = excluded.value",
      ["local_only_key", "keep-me"],
    );

    resetBreakerForTests();
    const fake = makeHealthy({
      settings: [{ key: "global_keywords", value: '["java"]' }],
    });
    setRemoteHarness(fake.harness);
    await hydrateFromRemote("test");

    const kept = await qOne("select value from app_settings where key = $1", ["local_only_key"]);
    expect(kept?.value).toBe("keep-me");
    const pulled = await qOne("select value from app_settings where key = $1", [
      "global_keywords",
    ]);
    expect(pulled?.value).toBe('["java"]');
  });
});

// ── outbox replay ──────────────────────────────────────────────────────────

describe("outbox replay", () => {
  it("replays a listing status change against the remote row id", async () => {
    const healthy = makeHealthy({ boards: [BOARD], listings: [LISTING] });
    setRemoteHarness(healthy.harness);
    await hydrateFromRemote("test");

    setRemoteHarness(downHarness);
    await run("update listings set status = $1 where id = $2", ["applied", 11]);

    const store = await getLocalStore();
    const entry = store!.readQueue()[0];
    expect(entry.kind).toBe("op");
    expect(entry.payload).toMatchObject({
      kind: "listing-update",
      boardName: "RemoteOK",
      externalId: "r1",
      fields: { status: "applied" },
    });
    // the local row already reflects the change
    expect(await qOne("select status from listings where id = 11")).toMatchObject({
      status: "applied",
    });

    // recover and drain: resolves remote id 11 via (board name, external id)
    const recovered = makeHealthy({ boards: [BOARD], listings: [LISTING] });
    setRemoteHarness(recovered.harness);
    resetBreakerForTests();
    const { drained } = await drainOutbox(store!);
    expect(drained).toBe(1);
    expect(recovered.runCalls[0].sql).toContain("update listings set status");
    expect(recovered.runCalls[0].params).toEqual(["applied", 11]);
  });

  it("normalizes board inserts so they replay by name", async () => {
    setRemoteHarness(downHarness);
    await run(
      "insert into boards (name, type, url, filter_keywords) values ($1, $2, $3, $4)",
      ["TestBoard", "api", "https://example.com/api", "[]"],
    );

    const store = await getLocalStore();
    const entry = store!.readQueue()[0];
    expect(entry.kind).toBe("op");
    expect(entry.payload).toMatchObject({ kind: "board-insert", name: "TestBoard" });

    const recovered = makeHealthy({ boards: [] });
    setRemoteHarness(recovered.harness);
    resetBreakerForTests();
    await drainOutbox(store!);
    expect(recovered.runCalls[0].sql).toContain("insert into boards");
    expect(recovered.runCalls[0].params[0]).toBe("TestBoard");
  });

  it("normalizes the board enable toggle into a field value", async () => {
    const healthy = makeHealthy({ boards: [BOARD], listings: [] });
    setRemoteHarness(healthy.harness);
    await hydrateFromRemote("test");

    setRemoteHarness(downHarness);
    await run(
      "update boards set enabled = case when enabled = 1 then 0 else 1 end where id = $1",
      [1],
    );
    const entry = (await getLocalStore())!.readQueue()[0];
    expect(entry.payload).toMatchObject({
      kind: "board-update",
      name: "RemoteOK",
      fields: { enabled: 0 },
    });
  });

  it("normalizes bulk listing inserts into column-keyed rows", async () => {
    const healthy = makeHealthy({ boards: [BOARD], listings: [] });
    setRemoteHarness(healthy.harness);
    await hydrateFromRemote("test");

    setRemoteHarness(downHarness);
    const inserted = await insertListings(1, [
      {
        externalId: "x1",
        title: "Backend Dev",
        company: "Globex",
        location: "Remote",
        isRemote: true,
        visaSponsorship: false,
        remoteScope: "anywhere",
        tags: '["java"]',
        skills: '["java"]',
        url: "https://example.com/x1",
        postedAt: null,
        deadline: null,
        fetchedAt: "2026-09-15T00:00:00.000Z",
        searchText: "backend dev",
        description: "desc",
      },
    ]);
    expect(inserted).toBe(1);

    const entry = (await getLocalStore())!.readQueue()[0];
    expect(entry.kind).toBe("op");
    expect(entry.payload).toMatchObject({ kind: "listings-insert", boardName: "RemoteOK" });
    expect((entry.payload as { rows: unknown[] }).rows).toHaveLength(1);

    // local row is immediately readable
    const local = await q("select * from listings where external_id = 'x1'");
    expect(local).toHaveLength(1);
  });

  it("drops unplayable statements but keeps draining", async () => {
    const healthy = makeHealthy({ boards: [BOARD], listings: [] });
    setRemoteHarness(healthy.harness);
    await hydrateFromRemote("test");

    setRemoteHarness(downHarness);
    // queue one statement that will always fail remotely
    await run("insert into boards (name) values ($1)", ["broken"]);

    const recovered = makeHealthy({ boards: [] });
    recovered.harness.run = async () => {
      throw new Error('duplicate key value violates unique constraint "boards_name_key"');
    };
    setRemoteHarness(recovered.harness);
    resetBreakerForTests();
    const { drained, remaining } = await drainOutbox((await getLocalStore())!);
    expect(drained).toBe(1); // dropped, queue not stuck
    expect(remaining).toBe(0);
  });
});
