import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

// ── Schema (feature-owned) ──────────────────────────────────────────────────
// The consumer API owns its table and provisions it lazily, so the core
// migrate() in src/db/index.ts stays untouched by this feature.

const ensured = new WeakSet<object>();

function ensureSchema(db: DatabaseSync): void {
  if (ensured.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      key_hash      TEXT NOT NULL UNIQUE,
      prefix        TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      last_used_at  TEXT,
      request_count INTEGER NOT NULL DEFAULT 0,
      revoked_at    TEXT
    );
  `);
  ensured.add(db);
}

// ── Types ───────────────────────────────────────────────────────────────────

/** Key metadata safe to render in the UI — never includes the plaintext/hash. */
export interface ApiKeyRecord {
  id: number;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  requestCount: number;
  revokedAt: string | null;
}

// ── Generation & hashing ────────────────────────────────────────────────────

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function createApiKey(
  db: DatabaseSync,
  name: string,
): { key: ApiKeyRecord; plaintext: string } {
  ensureSchema(db);
  const plaintext = `jrk_${randomBytes(32).toString("base64url")}`;
  const createdAt = new Date().toISOString();
  const res = db
    .prepare("INSERT INTO api_keys (name, key_hash, prefix, created_at) VALUES (?, ?, ?, ?)")
    .run(name, hashKey(plaintext), plaintext.slice(0, 12), createdAt);
  return {
    key: {
      id: Number(res.lastInsertRowid),
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
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    requestCount: r.request_count,
    revokedAt: r.revoked_at,
  };
}

export function listApiKeys(db: DatabaseSync): ApiKeyRecord[] {
  ensureSchema(db);
  return (
    db.prepare("SELECT * FROM api_keys ORDER BY id DESC").all() as unknown as ApiKeyRow[]
  ).map(rowToRecord);
}

/** Marks a key revoked; false when unknown or already revoked. */
export function revokeApiKey(db: DatabaseSync, id: number): boolean {
  ensureSchema(db);
  const res = db
    .prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(new Date().toISOString(), id);
  return Number(res.changes) > 0;
}
