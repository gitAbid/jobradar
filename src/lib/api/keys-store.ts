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
  user_id: string | null;
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
    userId: r.user_id ?? null,
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
    userId: string;
  }): Promise<number> {
    const rows = await remoteRunReturning<{ id: number }>(
      "insert into api_keys (name, key_hash, prefix, created_at, user_id) values ($1, $2, $3, $4::timestamptz, $5::uuid) returning id",
      [key.name, key.keyHash, key.prefix, key.createdAt, key.userId],
    );
    if (!rows[0]) throw new Error("api_keys insert returned no id");
    return Number(rows[0].id);
  }

  async list(userId: string): Promise<ApiKeyRecord[]> {
    const rows = await remoteQuery<ApiKeyRow>(
      "select * from api_keys where user_id = $1::uuid order by id desc",
      [userId],
    );
    return rows.map(rowToRecord);
  }

  async revoke(id: number, userId: string, revokedAt: string): Promise<boolean> {
    const count = await remoteRun(
      "update api_keys set revoked_at = $1::timestamptz where id = $2 and user_id = $3::uuid and revoked_at is null",
      [revokedAt, id, userId],
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

  async hitRate(keyId: number): Promise<{ count: number; retryAfterSeconds: number }> {
    const rows = await remoteRunReturning<{ count: number; retry: number }>(
      `insert into api_rate (key_id, window_start, count)
         values ($1::int, date_trunc('hour', now()), 1)
       on conflict (key_id, window_start) do update set count = api_rate.count + 1
       returning count,
         ceil(extract(epoch from (window_start + interval '1 hour' - now())))::int as retry`,
      [keyId],
    );
    if (!rows[0]) throw new Error("api_rate upsert returned no row");
    // Opportunistic cleanup of old windows; best-effort, never blocks the request.
    if (Math.random() < 0.01) {
      remoteRun("delete from api_rate where window_start < now() - interval '1 day'").catch(() => {});
    }
    return { count: Number(rows[0].count), retryAfterSeconds: Math.max(1, Number(rows[0].retry)) };
  }
}

const singleton = new NeonKeyStore();

/** The process-wide store used by routes and server actions. */
export function apiKeys(): KeyStore {
  return singleton;
}
