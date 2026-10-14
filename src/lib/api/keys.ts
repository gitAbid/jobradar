import { createHash, randomBytes } from "node:crypto";

// ── Types ───────────────────────────────────────────────────────────────────

/** Key metadata safe to render in the UI — never includes the plaintext/hash. */
export interface ApiKeyRecord {
  id: number;
  /** Owner; null only for unclaimed legacy keys (never usable for auth). */
  userId: string | null;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  requestCount: number;
  revokedAt: string | null;
}

/**
 * Storage port for API keys. The pure core below (generation, hashing, auth
 * semantics) is tested against InMemoryKeyStore; production uses the Postgres
 * adapter in src/lib/api/keys-store.ts.
 */
export interface KeyStore {
  insert(key: {
    name: string;
    keyHash: string;
    prefix: string;
    createdAt: string;
    userId: string;
  }): Promise<number>;
  /** The given user's keys only, newest first. */
  list(userId: string): Promise<ApiKeyRecord[]>;
  /** Marks revoked; resolves false when unknown, not owned by `userId`, or already revoked. */
  revoke(id: number, userId: string, revokedAt: string): Promise<boolean>;
  findByHash(keyHash: string): Promise<ApiKeyRecord | null>;
  /** Best-effort usage stats; must never throw into the request path. */
  recordUsage(id: number, usedAt: string): Promise<void>;
  /**
   * Counts one request against the key's current fixed 1-hour window
   * (atomic). Throws when the rate store is unavailable (callers fail closed).
   */
  hitRate(keyId: number): Promise<{ count: number; retryAfterSeconds: number }>;
}

/** Reference in-memory store — used by the test suite. */
export class InMemoryKeyStore implements KeyStore {
  private rows: ApiKeyRecord[] = [];
  private hashes = new Map<number, string>();
  private nextId = 1;
  private rates = new Map<string, number>();

  async insert(key: {
    name: string;
    keyHash: string;
    prefix: string;
    createdAt: string;
    userId: string;
  }): Promise<number> {
    const id = this.nextId++;
    this.rows.push({
      id,
      userId: key.userId,
      name: key.name,
      prefix: key.prefix,
      createdAt: key.createdAt,
      lastUsedAt: null,
      requestCount: 0,
      revokedAt: null,
    });
    this.hashes.set(id, key.keyHash);
    return id;
  }

  async list(userId: string): Promise<ApiKeyRecord[]> {
    // newest first, matching the Postgres adapter's `order by id desc`
    return this.rows
      .filter((r) => r.userId === userId)
      .map((r) => ({ ...r }))
      .sort((a, b) => b.id - a.id);
  }

  async revoke(id: number, userId: string, revokedAt: string): Promise<boolean> {
    const row = this.rows.find((r) => r.id === id && r.userId === userId && r.revokedAt === null);
    if (!row) return false;
    row.revokedAt = revokedAt;
    return true;
  }

  async findByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    for (const r of this.rows) {
      if (this.hashes.get(r.id) === keyHash) return { ...r };
    }
    return null;
  }

  async recordUsage(id: number, usedAt: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.lastUsedAt = usedAt;
      row.requestCount += 1;
    }
  }

  async hitRate(keyId: number): Promise<{ count: number; retryAfterSeconds: number }> {
    const now = Date.now();
    const windowStart = Math.floor(now / HOUR_MS) * HOUR_MS;
    const k = `${keyId}:${windowStart}`;
    const count = (this.rates.get(k) ?? 0) + 1;
    this.rates.set(k, count);
    return { count, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + HOUR_MS - now) / 1000)) };
  }
}

const HOUR_MS = 3_600_000;

// ── Generation & hashing ────────────────────────────────────────────────────

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function createApiKey(
  store: KeyStore,
  name: string,
  userId: string,
): Promise<{ key: ApiKeyRecord; plaintext: string }> {
  const plaintext = `jrk_${randomBytes(32).toString("base64url")}`;
  const createdAt = new Date().toISOString();
  const id = await store.insert({
    name,
    keyHash: hashKey(plaintext),
    prefix: plaintext.slice(0, 12),
    createdAt,
    userId,
  });
  return {
    key: {
      id,
      userId,
      name,
      prefix: plaintext.slice(0, 12),
      createdAt,
      lastUsedAt: null,
      requestCount: 0,
      revokedAt: null,
    },
    plaintext,
  };
}

export function listApiKeys(store: KeyStore, userId: string): Promise<ApiKeyRecord[]> {
  return store.list(userId);
}

export function revokeApiKey(store: KeyStore, id: number, userId: string): Promise<boolean> {
  return store.revoke(id, userId, new Date().toISOString());
}

// ── Request authentication ──────────────────────────────────────────────────

export type AuthResult =
  | { ok: true; key: ApiKeyRecord; userId: string }
  | { ok: false; status: 401 | 403 };

/** Usage stats are best-effort: written at most once per key per 60s. */
const USAGE_THROTTLE_MS = 60_000;
const lastUsageWrite = new WeakMap<object, Map<number, number>>();

async function recordUsage(store: KeyStore, keyId: number): Promise<void> {
  const now = Date.now();
  const perStore = lastUsageWrite.get(store) ?? new Map<number, number>();
  if (now - (perStore.get(keyId) ?? 0) < USAGE_THROTTLE_MS) return;
  perStore.set(keyId, now);
  lastUsageWrite.set(store, perStore);
  await store.recordUsage(keyId, new Date(now).toISOString());
}

/**
 * Verifies `Authorization: Bearer <key>` (primary) or `x-api-key: <key>`.
 * Records usage for valid, non-revoked keys.
 */
export async function authenticateApiKey(request: Request, store: KeyStore): Promise<AuthResult> {
  const header = request.headers.get("authorization");
  const presented = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : (request.headers.get("x-api-key")?.trim() || null);
  if (!presented) return { ok: false, status: 401 };

  const record = await store.findByHash(hashKey(presented));
  if (!record) return { ok: false, status: 401 };
  // Unclaimed legacy key (no owner): invalid until the admin claim assigns it.
  if (!record.userId) return { ok: false, status: 401 };
  if (record.revokedAt) return { ok: false, status: 403 };
  await recordUsage(store, record.id);
  return { ok: true, key: record, userId: record.userId };
}
