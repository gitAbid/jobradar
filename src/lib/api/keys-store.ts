import type { KeyStore, ApiKeyRecord } from "@/lib/api/keys";
import { remoteQuery, remoteRun, remoteRunReturning } from "@/db/remote";

/**
 * Neon-backed KeyStore. Failures throw: connection/limit errors are
 * classified by callers (see `classifyRemoteError`), real SQL bugs surface.
 */

interface ApiKeyRow {
  id: number;
  name: string;
  key_hash?: string;
  prefix: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
  request_count: number;
  revoked_at: Date | string | null;
}

/** timestamptz arrives as Date; the KeyStore contract uses ISO strings. */
function iso(v: Date | string | null): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : v;
}

function rowToRecord(r: ApiKeyRow): ApiKeyRecord {
  return {
    id: Number(r.id),
    name: r.name,
    prefix: r.prefix,
    createdAt: iso(r.created_at) ?? "",
    lastUsedAt: iso(r.last_used_at),
    requestCount: Number(r.request_count),
    revokedAt: iso(r.revoked_at),
  };
}

class NeonKeyStore implements KeyStore {
  async insert(key: {
    name: string;
    keyHash: string;
    prefix: string;
    createdAt: string;
  }): Promise<number> {
    const rows = await remoteRunReturning<{ id: number }>(
      "insert into api_keys (name, key_hash, prefix, created_at) values ($1, $2, $3, $4::timestamptz) returning id",
      [key.name, key.keyHash, key.prefix, key.createdAt],
    );
    if (!rows[0]) throw new Error("api_keys insert returned no id");
    return Number(rows[0].id);
  }

  async list(): Promise<ApiKeyRecord[]> {
    const rows = await remoteQuery<ApiKeyRow>("select * from api_keys order by id desc");
    return rows.map(rowToRecord);
  }

  async revoke(id: number, revokedAt: string): Promise<boolean> {
    const count = await remoteRun(
      "update api_keys set revoked_at = $1::timestamptz where id = $2 and revoked_at is null",
      [revokedAt, id],
    );
    return count > 0;
  }

  async findByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const rows = await remoteQuery<ApiKeyRow>("select * from api_keys where key_hash = $1", [
      keyHash,
    ]);
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async recordUsage(id: number, usedAt: string): Promise<void> {
    await remoteRun(
      "update api_keys set last_used_at = $1::timestamptz, request_count = request_count + 1 where id = $2",
      [usedAt, id],
    );
  }
}

const singleton = new NeonKeyStore();

/** The process-wide store used by routes and server actions. */
export function apiKeys(): KeyStore {
  return singleton;
}
