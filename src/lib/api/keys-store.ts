import type { KeyStore, ApiKeyRecord } from "@/lib/api/keys";
import { q, qOne, run } from "@/db";

/**
 * Postgres-backed KeyStore. The api_keys DDL is feature-owned and applied
 * lazily (once per process) so this feature stays out of the central
 * ensureSchema in src/db/index.ts. RLS is enabled because the table holds
 * credential hashes: anon/authenticated roles get nothing, while the server's
 * own connection (table owner via DATABASE_URL) is unaffected.
 */

interface ApiKeyRow {
  id: number;
  name: string;
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

let schemaReady: Promise<void> | null = null;

function ensureApiKeysSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await q(`
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
    `);
    await q(`alter table api_keys enable row level security`);
  })();
  return schemaReady;
}

class PostgresKeyStore implements KeyStore {
  async insert(key: { name: string; keyHash: string; prefix: string; createdAt: string }): Promise<number> {
    await ensureApiKeysSchema();
    const row = await qOne<{ id: number }>(
      "insert into api_keys (name, key_hash, prefix, created_at) values ($1, $2, $3, $4) returning id",
      [key.name, key.keyHash, key.prefix, key.createdAt],
    );
    return Number(row!.id);
  }

  async list(): Promise<ApiKeyRecord[]> {
    await ensureApiKeysSchema();
    const rows = await q<ApiKeyRow>("select * from api_keys order by id desc");
    return rows.map(rowToRecord);
  }

  async revoke(id: number, revokedAt: string): Promise<boolean> {
    await ensureApiKeysSchema();
    const count = await run(
      "update api_keys set revoked_at = $1 where id = $2 and revoked_at is null",
      [revokedAt, id],
    );
    return count > 0;
  }

  async findByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    await ensureApiKeysSchema();
    const row = await qOne<ApiKeyRow>("select * from api_keys where key_hash = $1", [keyHash]);
    return row ? rowToRecord(row) : null;
  }

  async recordUsage(id: number, usedAt: string): Promise<void> {
    try {
      await run(
        "update api_keys set last_used_at = $1, request_count = request_count + 1 where id = $2",
        [usedAt, id],
      );
    } catch {
      // stats must never break a request
    }
  }
}

const singleton = new PostgresKeyStore();

/** The process-wide store used by routes and server actions. */
export function apiKeys(): KeyStore {
  return singleton;
}
