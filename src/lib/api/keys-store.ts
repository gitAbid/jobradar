import type { KeyStore, ApiKeyRecord } from "@/lib/api/keys";
import {
  getRemoteHarness,
  isRemoteConfigured,
  remoteQuery,
  remoteRun,
  remoteRunReturning,
} from "@/db/remote";
import { getBreaker } from "@/db/remote-health";
import { classifyRemoteError } from "@/db/translate";
import { getLocalStore } from "@/db/local-store";
import { bufferBlobOps } from "@/lib/blob-sync";
import type { OutboxOp } from "@/db/outbox";

/**
 * Remote-authoritative KeyStore.
 *
 * Why this bypasses the local-first router (`q`/`run`): API keys need
 * strong consistency. The on-device SQLite mirror is eventually consistent
 * (hydrated at most every 2 min) and — on serverless hosts — ephemeral per
 * instance (`/tmp` is discarded between invocations). Routing keys through
 * it meant a key created on one Vercel instance was invisible on the next,
 * and local/remote row ids diverged so revokes missed. This store therefore
 * talks to Neon directly whenever it can and only falls back to the
 * on-device store when the remote is unreachable or unconfigured.
 */

interface ApiKeyRow {
  id: number;
  name: string;
  key_hash?: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
  revoked_at: string | null;
}

function rowToRecord(r: ApiKeyRow): ApiKeyRecord {
  return {
    id: Number(r.id),
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    requestCount: Number(r.request_count),
    revokedAt: r.revoked_at,
  };
}

const API_KEYS_DDL = `
  create table if not exists api_keys (
    id            integer generated always as identity primary key,
    name          text not null,
    key_hash      text not null unique,
    prefix        text not null,
    created_at    text not null,
    last_used_at  text,
    request_count integer not null default 0,
    revoked_at    text
  )
`;

let remoteSchemaReady: Promise<void> | null = null;

/**
 * Belt-and-suspenders for databases whose central schema ran before
 * `api_keys` joined it. Idempotent; runs once per process. Skipped under
 * the test harness (the fake remote has a fixed schema).
 */
function ensureRemoteApiKeysSchema(): Promise<void> {
  remoteSchemaReady ??= (async () => {
    if (getRemoteHarness()) return;
    await remoteRun(API_KEYS_DDL);
    await remoteRun(`alter table api_keys enable row level security`);
  })().catch((err) => {
    remoteSchemaReady = null;
    throw err;
  });
  return remoteSchemaReady;
}

/** True when a remote attempt should be made (configured + breaker allows). */
function canTryRemote(): boolean {
  if (!isRemoteConfigured() && !getRemoteHarness()) return false;
  return getBreaker().canAttempt();
}

/**
 * Run `fn` against Neon. Connection/limit failures trip the breaker and
 * resolve `{ ok: false }` so callers fall back locally; real SQL bugs
 * rethrow — they must surface, never masquerade as "not found".
 */
async function tryRemote<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  if (!canTryRemote()) return { ok: false };
  try {
    const value = await fn();
    getBreaker().recordSuccess();
    return { ok: true, value };
  } catch (err) {
    const cls = classifyRemoteError(err);
    if (cls === "query") throw err;
    getBreaker().recordFailure(err, cls);
    console.warn(
      "[jobradar] api-keys: remote unreachable, using local fallback:",
      err instanceof Error ? err.message : err,
    );
    return { ok: false };
  }
}

/** Best-effort mirror of a remote row into the on-device store (same id). */
async function mirrorRemoteRow(row: {
  id: number;
  name: string;
  keyHash: string;
  prefix: string;
  createdAt: string;
}): Promise<void> {
  const store = await getLocalStore();
  if (!store) return;
  store.exec(
    `insert into api_keys (id, name, key_hash, prefix, created_at)
     values ($1, $2, $3, $4, $5) on conflict (key_hash) do nothing`,
    [row.id, row.name, row.keyHash, row.prefix, row.createdAt],
  );
}

async function mirrorRevokeLocal(id: number, revokedAt: string): Promise<void> {
  const store = await getLocalStore();
  if (!store) return;
  store.exec(`update api_keys set revoked_at = $1 where id = $2 and revoked_at is null`, [
    revokedAt,
    id,
  ]);
}

class RemoteFirstKeyStore implements KeyStore {
  async insert(key: {
    name: string;
    keyHash: string;
    prefix: string;
    createdAt: string;
  }): Promise<number> {
    const remote = await tryRemote(async () => {
      await ensureRemoteApiKeysSchema();
      const rows = await remoteRunReturning<{ id: number }>(
        "insert into api_keys (name, key_hash, prefix, created_at) values ($1, $2, $3, $4) returning id",
        [key.name, key.keyHash, key.prefix, key.createdAt],
      );
      if (!rows[0]) throw new Error("api_keys insert returned no id");
      return Number(rows[0].id);
    });
    if (remote.ok) {
      await mirrorRemoteRow({ ...key, id: remote.value }).catch(() => {});
      return remote.value;
    }

    // Remote down or unconfigured: persist locally and queue a replay op so
    // the key reaches Neon on recovery (long-lived hosts; on serverless the
    // on-device store is ephemeral — see isLocalFirstEnabled).
    const store = await getLocalStore();
    if (!store) {
      throw new Error(
        "Database unavailable — could not create the API key. Try again shortly.",
      );
    }
    const res = store.exec(
      "insert into api_keys (name, key_hash, prefix, created_at) values ($1, $2, $3, $4) returning id",
      [key.name, key.keyHash, key.prefix, key.createdAt],
    );
    const row = res.rows[0] as unknown as { id: number } | undefined;
    if (!row) throw new Error("local api_keys insert returned no id");
    const id = Number(row.id);
    const insertOp: OutboxOp = {
      kind: "api-key-insert",
      name: key.name,
      keyHash: key.keyHash,
      prefix: key.prefix,
      createdAt: key.createdAt,
    };
    try {
      store.enqueue("op", insertOp);
    } catch {
      // queue write must never break key creation
    }
    bufferBlobOps(insertOp); // durable on serverless; no-op without a store
    return id;
  }

  async list(): Promise<ApiKeyRecord[]> {
    const remote = await tryRemote(async () => {
      await ensureRemoteApiKeysSchema();
      const rows = await remoteQuery<ApiKeyRow>("select * from api_keys order by id desc");
      return rows.map(rowToRecord);
    });
    if (remote.ok) return remote.value;

    const store = await getLocalStore();
    if (!store) return [];
    return store
      .exec("select * from api_keys order by id desc")
      .rows.map((r) => rowToRecord(r as unknown as ApiKeyRow));
  }

  async revoke(id: number, revokedAt: string): Promise<boolean> {
    const remote = await tryRemote(async () => {
      await ensureRemoteApiKeysSchema();
      const count = await remoteRun(
        "update api_keys set revoked_at = $1 where id = $2 and revoked_at is null",
        [revokedAt, id],
      );
      return count > 0;
    });
    if (remote.ok) {
      await mirrorRevokeLocal(id, revokedAt).catch(() => {});
      return remote.value;
    }

    const store = await getLocalStore();
    if (!store) {
      throw new Error("Database unavailable — could not revoke the API key.");
    }
    // Resolve the hash first so the queued replay stays correct even though
    // local and remote row ids are independent sequences.
    const found = store.exec("select key_hash from api_keys where id = $1", [id]).rows[0] as
      | unknown as { key_hash: string } | undefined;
    const res = store.exec(
      "update api_keys set revoked_at = $1 where id = $2 and revoked_at is null",
      [revokedAt, id],
    );
    const ok = res.changes > 0;
    if (ok && found) {
      const updateOp: OutboxOp = {
        kind: "api-key-update",
        keyHash: String(found.key_hash),
        fields: { revoked_at: revokedAt },
      };
      try {
        store.enqueue("op", updateOp);
      } catch {
        // queue write must never break revocation
      }
      bufferBlobOps(updateOp);
    }
    return ok;
  }

  async findByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const remote = await tryRemote(async () => {
      await ensureRemoteApiKeysSchema();
      const rows = await remoteQuery<ApiKeyRow>(
        "select * from api_keys where key_hash = $1",
        [keyHash],
      );
      return rows[0] ? rowToRecord(rows[0]) : null;
    });
    if (remote.ok) return remote.value;

    const store = await getLocalStore();
    if (!store) return null;
    const rows = store.exec("select * from api_keys where key_hash = $1", [keyHash]).rows;
    const row = rows[0] as unknown as ApiKeyRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  async recordUsage(id: number, usedAt: string): Promise<void> {
    const remote = await tryRemote(async () => {
      await ensureRemoteApiKeysSchema();
      await remoteRun(
        "update api_keys set last_used_at = $1, request_count = request_count + 1 where id = $2",
        [usedAt, id],
      );
    });
    if (!remote.ok) {
      // Offline usage stats: local-only, best-effort. The op normalizer
      // re-keys this by key_hash at replay time (see outbox.ts).
      try {
        const store = await getLocalStore();
        store?.exec(
          "update api_keys set last_used_at = $1, request_count = request_count + 1 where id = $2",
          [usedAt, id],
        );
      } catch {
        // stats must never break a request
      }
    }
  }
}

const singleton = new RemoteFirstKeyStore();

/** The process-wide store used by routes and server actions. */
export function apiKeys(): KeyStore {
  return singleton;
}

/** Reset the lazy remote-schema guard between tests. */
export function resetApiKeysSchemaForTests(): void {
  remoteSchemaReady = null;
}
