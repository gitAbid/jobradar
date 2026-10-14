import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  q,
  qOne,
  resetLocalFirstForTests,
  run,
  setRemoteHarness,
  type RemoteHarness,
} from "@/db";
import { getLocalStore } from "@/db/local-store";
import { resetBreakerForTests } from "@/db/remote-health";
import {
  applyOpLocal,
  blobStatus,
  bufferBlobOps,
  drainBlobOps,
  ensureFallbackStore,
  flushBlobOps,
  isBlobConfigured,
  isBlobServeMode,
  resetBlobStateForTests,
  setBlobBackendForTests,
  uploadSnapshot,
  type BlobBackend,
} from "@/lib/blob-sync";
import type { OutboxOp } from "@/db/outbox";

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

class FakeBlob implements BlobBackend {
  files = new Map<string, Uint8Array>();
  puts = 0;
  lists = 0;
  async put(pathname: string, body: string | Uint8Array): Promise<void> {
    this.puts += 1;
    this.files.set(
      pathname,
      typeof body === "string" ? new TextEncoder().encode(body) : body,
    );
  }
  async get(pathname: string): Promise<Uint8Array | null> {
    return this.files.get(pathname) ?? null;
  }
  async list(prefix: string): Promise<string[]> {
    this.lists += 1;
    return [...this.files.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
  async del(pathnames: string[]): Promise<void> {
    for (const p of pathnames) this.files.delete(p);
  }
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
  description: "description here",
};

function healthyHarness() {
  const runCalls: Array<{ sql: string; params: unknown[] }> = [];
  const harness: RemoteHarness = {
    query: async (sql) => {
      const s = sql.toLowerCase();
      if (s.includes("from boards") && s.includes("select *")) return [BOARD];
      if (s.includes("from listings") && s.includes("select *")) return [LISTING];
      return [];
    },
    run: async (sql, params) => {
      runCalls.push({ sql, params });
      return 1;
    },
  };
  return { harness, runCalls };
}

let dir: string;
let fake: FakeBlob;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "jobradar-blob-"));
  process.env.LOCAL_DB_PATH = path.join(dir, "local.db");
  process.env.DATABASE_URL = "postgres://harness:test@localhost:5432/db";
  fake = new FakeBlob();
  setBlobBackendForTests(fake);
  resetBlobStateForTests();
});

afterEach(async () => {
  await resetLocalFirstForTests();
  setRemoteHarness(null);
  setBlobBackendForTests(null);
  resetBlobStateForTests();
  delete process.env.LOCAL_DB_PATH;
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.LOCAL_FIRST;
  rmSync(dir, { recursive: true, force: true });
});

describe("configuration", () => {
  it("is inert without a store and active with one", () => {
    setBlobBackendForTests(null);
    delete process.env.BLOB_STORE_ID;
    expect(isBlobConfigured()).toBe(false);
    expect(blobStatus().configured).toBe(false);
    process.env.BLOB_STORE_ID = "store_test123";
    expect(isBlobConfigured()).toBe(true);
    delete process.env.BLOB_STORE_ID;
  });

  it("serve mode only where local-first is disabled", () => {
    expect(isBlobServeMode()).toBe(false); // dev: mirror persists
    process.env.VERCEL = "1";
    expect(isBlobServeMode()).toBe(true);
  });
});

describe("op buffer", () => {
  it("batches many ops into a single blob", async () => {
    const op: OutboxOp = {
      kind: "api-key-insert",
      name: "app",
      keyHash: "abc",
      prefix: "jrk_",
      createdAt: new Date().toISOString(),
    };
    bufferBlobOps([op, op, op]);
    bufferBlobOps(op);
    const res = await flushBlobOps();
    expect(res).toEqual({ uploaded: true, opCount: 4 });
    const blobs = [...fake.files.keys()].filter((k) => k.includes("/oplog/"));
    expect(blobs).toHaveLength(1);
    const payload = JSON.parse(new TextDecoder().decode(fake.files.get(blobs[0])!));
    expect(payload.ops).toHaveLength(4);
    // second flush is a no-op
    expect(await flushBlobOps()).toEqual({ uploaded: false, opCount: 0 });
    expect(fake.puts).toBe(1);
  });
});

describe("drain", () => {
  it("replays op blobs to Neon and deletes them", async () => {
    const { harness, runCalls } = healthyHarness();
    setRemoteHarness(harness);
    fake.files.set(
      "jobradar/oplog/1000000000000-a.json",
      new TextEncoder().encode(
        JSON.stringify({
          v: 1,
          createdAt: new Date().toISOString(),
          ops: [
            { kind: "board-insert", sql: "insert into boards (name) values ($1)", params: ["B"], name: "B" },
          ] as OutboxOp[],
        }),
      ),
    );
    const res = await drainBlobOps({ force: true });
    expect(res.drained).toBe(1);
    expect(res.deleted).toBe(1);
    expect(runCalls.length).toBeGreaterThan(0);
    expect([...fake.files.keys()]).toHaveLength(0);
  });

  it("drops corrupt blobs instead of stalling", async () => {
    setRemoteHarness(healthyHarness().harness);
    fake.files.set("jobradar/oplog/1000000000000-bad.json", new TextEncoder().encode("nope{"));
    const res = await drainBlobOps({ force: true });
    expect(res.deleted).toBe(1);
    expect([...fake.files.keys()]).toHaveLength(0);
  });

  it("stops on connection failure and keeps the blob", async () => {
    setRemoteHarness(downHarness);
    resetBreakerForTests();
    fake.files.set(
      "jobradar/oplog/1000000000000-c.json",
      new TextEncoder().encode(
        JSON.stringify({ v: 1, createdAt: new Date().toISOString(), ops: [{ kind: "sql", sql: "select 1", params: [] }] as OutboxOp[] }),
      ),
    );
    const res = await drainBlobOps({ force: true });
    expect(res.drained).toBe(0);
    expect([...fake.files.keys()]).toHaveLength(1);
  });
});

describe("snapshot round-trip", () => {
  it("uploads a converged snapshot and restores it into an empty instance", async () => {
    setRemoteHarness(healthyHarness().harness);
    const up = await uploadSnapshot();
    expect(up.uploaded).toBe(true);
    expect([...fake.files.keys()].filter((k) => k.endsWith(".db.gz"))).toHaveLength(1);
    expect([...fake.files.keys()]).toContain("jobradar/snapshots/latest.json");
    // second upload is throttled
    expect((await uploadSnapshot()).uploaded).toBe(false);

    // simulate a fresh serverless instance: close + wipe the file
    await resetLocalFirstForTests();
    rmSync(path.join(dir, "local.db"), { force: true });
    resetBlobStateForTests();

    const store = await ensureFallbackStore();
    expect(store).not.toBeNull();
    const rows = await q("select * from listings");
    expect(rows).toHaveLength(1);
    expect(rows[0].external_id).toBe("r1");
    expect(store!.getMeta("snapshot_created_at")).not.toBeNull();
  });
});

describe("serve-mode routing (Vercel + Neon down)", () => {
  it("writes locally, buffers the op, and serves reads from the fallback", async () => {
    process.env.VERCEL = "1";
    setRemoteHarness(downHarness);

    const n = await run(
      "insert into app_settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value",
      ["global_keywords", '["java"]'],
    );
    expect(n).toBe(1);

    // read is served from the Blob-seeded fallback instead of throwing
    const row = await qOne<{ value: string }>("select value from app_settings where key = $1", [
      "global_keywords",
    ]);
    expect(row?.value).toBe('["java"]');

    // the mutation was staged for durable upload — either auto-flushed at
    // request end via after(), or still pending; one explicit flush settles it
    await flushBlobOps();
    expect(fake.puts).toBe(1);
    const opBlobs = [...fake.files.keys()].filter((k) => k.includes("/oplog/"));
    expect(opBlobs).toHaveLength(1);
    const payload = JSON.parse(new TextDecoder().decode(fake.files.get(opBlobs[0])!));
    expect(payload.ops.length).toBeGreaterThan(0);
  });
});

describe("applyOpLocal", () => {
  it("replays every op kind against local rows by natural key", async () => {
    const store = (await getLocalStore({ force: true }))!;
    store.exec("insert into boards (name, type, url, filter_keywords) values ($1, $2, $3, $4)", [
      "Local",
      "api",
      "https://example.com",
      "[]",
    ]);
    const boardId = Number(store.select("select id from boards where name = 'Local'")[0].id);
    store.exec(
      "insert into listings (board_id, external_id, title, company, location, is_remote, visa_sponsorship, tags, skills, url, fetched_at, search_text, description) values ($1,$2,$3,$4,$5,0,0,'[]','[]','https://example.com/x','2026-09-15T00:00:00.000Z','','')",
      [boardId, "x1", "T", "C", "L"],
    );

    const ops: OutboxOp[] = [
      { kind: "board-insert", sql: "insert into boards (name, type, url) values ($1,$2,$3)", params: ["B2", "api", "https://b2.example"], name: "B2" },
      { kind: "board-update", name: "Local", fields: { last_status: "ok" } },
      {
        kind: "listings-insert",
        boardName: "Local",
        rows: [{ board_id: 999, external_id: "x2", title: "T2", company: "", location: "", is_remote: 0, visa_sponsorship: 0, tags: "[]", skills: "[]", url: "https://example.com/x2", fetched_at: "2026-09-15T00:00:00.000Z", search_text: "", description: "" }],
      },
      { kind: "listing-update", boardName: "Local", externalId: "x1", fields: { status: "applied" } },
      { kind: "api-key-insert", name: "k", keyHash: "h1", prefix: "p", createdAt: "2026-09-15T00:00:00.000Z" },
      { kind: "api-key-update", keyHash: "h1", fields: { revoked_at: "2026-09-16T00:00:00.000Z" } },
    ];
    for (const op of ops) applyOpLocal(store, op);

    expect(store.select("select name from boards where name = 'B2'")).toHaveLength(1);
    expect(store.select("select last_status from boards where name = 'Local'")[0].last_status).toBe("ok");
    // listings-insert re-resolves the foreign board id (999 → local id)
    expect(store.select("select board_id from listings where external_id = 'x2'")[0].board_id).toBe(boardId);
    expect(store.select("select status from listings where external_id = 'x1'")[0].status).toBe("applied");
    expect(store.select("select revoked_at from api_keys where key_hash = 'h1'")[0].revoked_at).toBe(
      "2026-09-16T00:00:00.000Z",
    );
  });
});
