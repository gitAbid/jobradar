import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiKey, authenticateApiKey, hashKey, listApiKeys, revokeApiKey } from "@/lib/api/keys";

let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
});

describe("hashKey", () => {
  it("is sha256 hex of the presented key", () => {
    expect(hashKey("jrk_test")).toBe(
      createHash("sha256").update("jrk_test").digest("hex"),
    );
  });
});

describe("createApiKey", () => {
  it("stores only a hash and returns the plaintext once", () => {
    const { key, plaintext } = createApiKey(db, "my-app");

    expect(plaintext).toMatch(/^jrk_[A-Za-z0-9_-]{43}$/);
    expect(key.name).toBe("my-app");
    expect(key.prefix).toBe(plaintext.slice(0, 12));
    expect(key.revokedAt).toBeNull();
    expect(key.lastUsedAt).toBeNull();
    expect(key.requestCount).toBe(0);

    const row = db
      .prepare("SELECT key_hash, prefix, name FROM api_keys WHERE id = ?")
      .get(key.id) as { key_hash: string; prefix: string; name: string };
    expect(row.key_hash).toBe(hashKey(plaintext));
    expect(row.key_hash).not.toContain(plaintext);
    expect(row.prefix).toBe(key.prefix);
  });

  it("generates unique plaintexts", () => {
    const a = createApiKey(db, "a");
    const b = createApiKey(db, "b");
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});

describe("listApiKeys / revokeApiKey", () => {
  it("lists newest first and records revocation", () => {
    const a = createApiKey(db, "a");
    const b = createApiKey(db, "b");

    expect(listApiKeys(db).map((k) => k.id)).toEqual([b.key.id, a.key.id]);

    expect(revokeApiKey(db, a.key.id)).toBe(true);
    const revoked = listApiKeys(db).find((k) => k.id === a.key.id);
    expect(revoked?.revokedAt).not.toBeNull();

    expect(revokeApiKey(db, a.key.id)).toBe(false); // already revoked
    expect(revokeApiKey(db, 9999)).toBe(false); // unknown
  });
});

function authRequest(key?: string, mode: "bearer" | "x-api-key" = "bearer"): Request {
  const headers = new Headers();
  if (key) {
    if (mode === "bearer") headers.set("authorization", `Bearer ${key}`);
    else headers.set("x-api-key", key);
  }
  return new Request("https://jobradar.local/api/v1/jobs", { headers });
}

describe("authenticateApiKey", () => {
  it("401s when no key is presented", () => {
    expect(authenticateApiKey(authRequest(), db)).toEqual({ ok: false, status: 401 });
  });

  it("401s on an unknown key", () => {
    expect(authenticateApiKey(authRequest("jrk_nope"), db)).toEqual({ ok: false, status: 401 });
  });

  it("accepts a valid Bearer key and records usage", () => {
    const { plaintext, key } = createApiKey(db, "app");
    const res = authenticateApiKey(authRequest(plaintext), db);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.key.id).toBe(key.id);

    const row = db
      .prepare("SELECT last_used_at, request_count FROM api_keys WHERE id = ?")
      .get(key.id) as { last_used_at: string | null; request_count: number };
    expect(row.request_count).toBe(1);
    expect(row.last_used_at).not.toBeNull();
  });

  it("accepts x-api-key as an alternative header", () => {
    const { plaintext } = createApiKey(db, "app");
    expect(authenticateApiKey(authRequest(plaintext, "x-api-key"), db).ok).toBe(true);
  });

  it("throttles usage writes to once per 60s window", () => {
    const { plaintext, key } = createApiKey(db, "app");
    authenticateApiKey(authRequest(plaintext), db);
    authenticateApiKey(authRequest(plaintext), db);
    const row = db
      .prepare("SELECT request_count FROM api_keys WHERE id = ?")
      .get(key.id) as { request_count: number };
    expect(row.request_count).toBe(1);
  });

  it("403s a revoked key", () => {
    const { plaintext } = createApiKey(db, "app");
    const first = authenticateApiKey(authRequest(plaintext), db);
    if (!first.ok) throw new Error("expected first auth to succeed");
    revokeApiKey(db, first.key.id);
    expect(authenticateApiKey(authRequest(plaintext), db)).toEqual({ ok: false, status: 403 });
  });
});
