import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  authenticateApiKey,
  createApiKey,
  hashKey,
  InMemoryKeyStore,
  listApiKeys,
  revokeApiKey,
  type KeyStore,
} from "@/lib/api/keys";

const OWNER = "00000000-0000-4000-8000-00000000000a";
let store: KeyStore;
beforeEach(() => {
  store = new InMemoryKeyStore();
});

describe("hashKey", () => {
  it("is sha256 hex of the presented key", () => {
    expect(hashKey("jrk_test")).toBe(
      createHash("sha256").update("jrk_test").digest("hex"),
    );
  });
});

describe("createApiKey", () => {
  it("stores only a hash and returns the plaintext once", async () => {
    const { key, plaintext } = await createApiKey(store, "my-app", OWNER);

    expect(plaintext).toMatch(/^jrk_[A-Za-z0-9_-]{43}$/);
    expect(key.name).toBe("my-app");
    expect(key.prefix).toBe(plaintext.slice(0, 12));
    expect(key.revokedAt).toBeNull();
    expect(key.lastUsedAt).toBeNull();
    expect(key.requestCount).toBe(0);

    const listed = await listApiKeys(store, OWNER);
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe("my-app");
    // the plaintext is nowhere in the stored record
    expect(JSON.stringify(listed)).not.toContain(plaintext);
  });

  it("generates unique plaintexts", async () => {
    const a = await createApiKey(store, "a", OWNER);
    const b = await createApiKey(store, "b", OWNER);
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});

describe("listApiKeys / revokeApiKey", () => {
  it("lists newest first and records revocation", async () => {
    const a = await createApiKey(store, "a", OWNER);
    const b = await createApiKey(store, "b", OWNER);

    expect((await listApiKeys(store, OWNER)).map((k) => k.id)).toEqual([b.key.id, a.key.id]);

    expect(await revokeApiKey(store, a.key.id, OWNER)).toBe(true);
    const revoked = (await listApiKeys(store, OWNER)).find((k) => k.id === a.key.id);
    expect(revoked?.revokedAt).not.toBeNull();

    expect(await revokeApiKey(store, a.key.id, OWNER)).toBe(false); // already revoked
    expect(await revokeApiKey(store, 9999, OWNER)).toBe(false); // unknown
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
  it("401s when no key is presented", async () => {
    expect(await authenticateApiKey(authRequest(), store)).toEqual({ ok: false, status: 401 });
  });

  it("401s on an unknown key", async () => {
    expect(await authenticateApiKey(authRequest("jrk_nope"), store)).toEqual({
      ok: false,
      status: 401,
    });
  });

  it("accepts a valid Bearer key and records usage", async () => {
    const { plaintext, key } = await createApiKey(store, "app", OWNER);
    const res = await authenticateApiKey(authRequest(plaintext), store);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.key.id).toBe(key.id);

    const [row] = await listApiKeys(store, OWNER);
    expect(row.requestCount).toBe(1);
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("accepts x-api-key as an alternative header", async () => {
    const { plaintext } = await createApiKey(store, "app", OWNER);
    expect((await authenticateApiKey(authRequest(plaintext, "x-api-key"), store)).ok).toBe(true);
  });

  it("throttles usage writes to once per 60s window", async () => {
    const { plaintext, key } = await createApiKey(store, "app", OWNER);
    await authenticateApiKey(authRequest(plaintext), store);
    await authenticateApiKey(authRequest(plaintext), store);
    const [row] = await listApiKeys(store, OWNER);
    expect(row.requestCount).toBe(1);
    expect(row.id).toBe(key.id);
  });

  it("403s a revoked key", async () => {
    const { plaintext } = await createApiKey(store, "app", OWNER);
    const first = await authenticateApiKey(authRequest(plaintext), store);
    if (!first.ok) throw new Error("expected first auth to succeed");
    await revokeApiKey(store, first.key.id, OWNER);
    expect(await authenticateApiKey(authRequest(plaintext), store)).toEqual({
      ok: false,
      status: 403,
    });
  });
});
