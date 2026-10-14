import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setRemoteHarness, type RemoteHarness } from "@/db";
import { classifyRemoteError } from "@/db/errors";
import { hashKey } from "@/lib/api/keys";
import { apiKeys } from "@/lib/api/keys-store";

const OWNER = "00000000-0000-4000-8000-00000000000a";
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

interface RemoteKeyRow {
  id: number;
  name: string;
  key_hash: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
  revoked_at: string | null;
}

/** Minimal fake Neon backing just the api_keys surface. */
function makeApiRemote() {
  const rows: RemoteKeyRow[] = [];
  let nextId = 100; // remote ids deliberately differ from local autoincrement
  const runCalls: Array<{ sql: string; params: unknown[] }> = [];
  const harness: RemoteHarness = {
    query: async (sql, params): Promise<Record<string, unknown>[]> => {
      const s = sql.toLowerCase();
      if (s.startsWith("insert into api_keys")) {
        const row: RemoteKeyRow = {
          id: nextId++,
          name: String(params[0]),
          key_hash: String(params[1]),
          prefix: String(params[2]),
          created_at: String(params[3]),
          last_used_at: null,
          request_count: 0,
          revoked_at: null,
        };
        rows.push(row);
        return [{ id: row.id }];
      }
      if (s.includes("from api_keys")) {
        if (s.includes("key_hash = $1")) {
          return rows.filter((r) => r.key_hash === params[0]) as unknown as Record<
            string,
            unknown
          >[];
        }
        if (s.includes("where id")) {
          return rows.filter((r) => r.id === Number(params[0])) as unknown as Record<
            string,
            unknown
          >[];
        }
        return [...rows].sort((a, b) => b.id - a.id) as unknown as Record<string, unknown>[];
      }
      return [];
    },
    run: async (sql, params) => {
      runCalls.push({ sql, params });
      const s = sql.toLowerCase();
      if (s.startsWith("create") || s.startsWith("alter")) return 0;
      if (s.includes("insert into api_keys")) {
        if (!rows.some((r) => r.key_hash === String(params[1]))) {
          rows.push({
            id: nextId++,
            name: String(params[0]),
            key_hash: String(params[1]),
            prefix: String(params[2]),
            created_at: String(params[3]),
            last_used_at: null,
            request_count: 0,
            revoked_at: null,
          });
        }
        return 1;
      }
      if (s.includes("update api_keys set revoked_at")) {
        const row = rows.find((r) => r.id === Number(params[1]));
        if (row && row.revoked_at === null) {
          row.revoked_at = String(params[0]);
          return 1;
        }
        return 0;
      }
      if (s.includes("update api_keys set last_used_at")) {
        const row = rows.find((r) => r.id === Number(params[1]));
        if (row) {
          row.last_used_at = String(params[0]);
          row.request_count += 1;
          return 1;
        }
        return 0;
      }
      return 1;
    },
  };
  return { harness, rows, runCalls };
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://harness:test@localhost:5432/db";
});

afterEach(() => {
  setRemoteHarness(null);
  delete process.env.DATABASE_URL;
});

describe("NeonKeyStore", () => {
  it("inserts remotely and lists the remote row immediately", async () => {
    const fake = makeApiRemote();
    setRemoteHarness(fake.harness);
    const store = apiKeys();

    const id = await store.insert({
      name: "my-app",
      keyHash: hashKey("jrk_test_1"),
      prefix: "jrk_test_1".slice(0, 12),
      createdAt: new Date().toISOString(),
      userId: OWNER,
    });
    expect(id).toBe(100); // the REMOTE id, not a local autoincrement id

    const listed = await store.list(OWNER);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: 100, name: "my-app" });
  });

  it("finds keys by hash for request auth", async () => {
    const fake = makeApiRemote();
    setRemoteHarness(fake.harness);
    const store = apiKeys();

    await store.insert({
      name: "app",
      keyHash: hashKey("jrk_secret"),
      prefix: "jrk_secret",
      createdAt: new Date().toISOString(),
      userId: OWNER,
    });
    const found = await store.findByHash(hashKey("jrk_secret"));
    expect(found?.name).toBe("app");
    expect(await store.findByHash(hashKey("jrk_nope"))).toBeNull();
  });

  it("revokes by remote id and reports unknown ids", async () => {
    const fake = makeApiRemote();
    setRemoteHarness(fake.harness);
    const store = apiKeys();

    const id = await store.insert({
      name: "app",
      keyHash: hashKey("jrk_revoke_me"),
      prefix: "jrk_revoke_",
      createdAt: new Date().toISOString(),
      userId: OWNER,
    });
    expect(await store.revoke(id, OWNER, new Date().toISOString())).toBe(true);
    expect(await store.revoke(id, OWNER, new Date().toISOString())).toBe(false);
    expect(await store.revoke(9999, OWNER, new Date().toISOString())).toBe(false);

    const listed = await store.list(OWNER);
    expect(listed[0].revokedAt).not.toBeNull();
  });
});

describe("NeonKeyStore (remote down)", () => {
  it("throws a classifiable error instead of falling back", async () => {
    setRemoteHarness(downHarness);
    const store = apiKeys();

    const err = await store
      .insert({
        name: "offline-app",
        keyHash: hashKey("jrk_offline"),
        prefix: "jrk_offline",
        createdAt: new Date().toISOString(),
        userId: OWNER,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(classifyRemoteError(err)).toBe("connection");

    await expect(store.list(OWNER)).rejects.toThrow(/ECONNREFUSED/);
    await expect(store.findByHash(hashKey("x"))).rejects.toThrow(/ECONNREFUSED/);
    await expect(store.revoke(1, OWNER, new Date().toISOString())).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("NeonKeyStore (real schema)", () => {
  it("rejects keys of disabled users", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const db = new PGlite();
    const dir = join(process.cwd(), "db/migrations");
    for (const f of readdirSync(dir).sort()) if (f.endsWith(".sql")) await db.exec(readFileSync(join(dir, f), "utf8"));
    await db.query("insert into users (id, email) values ($1, 'o@x.io')", [OWNER]);
    await db.query(
      "insert into api_keys (name, prefix, key_hash, user_id, created_at) values ('k', 'jrk_d', $1, $2, now())",
      [hashKey("jrk_disabled"), OWNER],
    );
    setRemoteHarness({
      query: async (sql, params) => (await db.query(sql, params)).rows as Record<string, unknown>[],
      run: async (sql, params) => (await db.query(sql, params)).affectedRows ?? 0,
    });
    try {
      expect(await apiKeys().findByHash(hashKey("jrk_disabled"))).not.toBeNull();
      await db.query("update users set disabled_at = now() where id = $1", [OWNER]);
      expect(await apiKeys().findByHash(hashKey("jrk_disabled"))).toBeNull();
    } finally {
      setRemoteHarness(null);
    }
  });
});
