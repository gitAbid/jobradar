import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiKey, hashKey, listApiKeys, revokeApiKey } from "@/lib/api/keys";

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
