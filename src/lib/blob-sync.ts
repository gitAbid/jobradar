/**
 * Blob-backed durability for serverless hosts (Vercel Blob, private store).
 *
 * The on-device SQLite mirror is ephemeral on serverless (`/tmp` dies with
 * the instance), so this module gives it a durable backing with two
 * primitives that both fit Hobby quotas comfortably:
 *
 *  - **op log**: every mutation captured while Neon is unreachable is
 *    mirrored to Blob as one small JSON blob per *flush* (batched per
 *    request via `after()`, so a whole refresh is ~1 write, not thousands).
 *    Ops reuse the outbox normalization (`OutboxOp`: natural keys, replay-
 *    safe), so at-least-once replay converges.
 *  - **snapshot**: a gzipped full-database file plus a `latest.json`
 *    pointer, refreshed at most every 12 h by the sync route. Cold starts
 *    restore from it only when Neon is unreachable — normal operation never
 *    touches it, so it costs ~nothing.
 *
 * Without a connected store every function below is a cheap no-op and the
 * app behaves exactly as before. Server-only: imports node builtins and
 * @vercel/blob — never import from client components.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";
import {
  getLocalStore,
  isLocalFirstEnabled,
  localDbPathFromEnv,
  type LocalStore,
} from "@/db/local-store";
import { getRemoteHarness, isRemoteConfigured } from "@/db/remote";
import { getBreaker } from "@/db/remote-health";
import { pullSnapshot, replayOp } from "@/db/sync";
import { classifyRemoteError } from "@/db/translate";
import type { OutboxOp } from "@/db/outbox";

const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);

const OPLOG_PREFIX = "jobradar/oplog/";
const SNAPSHOT_PREFIX = "jobradar/snapshots/";
const SNAPSHOT_POINTER = `${SNAPSHOT_PREFIX}latest.json`;
const SNAPSHOT_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;
const DRAIN_MIN_INTERVAL_MS = 10 * 60 * 1000;
const OP_BUFFER_CAP = 2000;
const SNAPSHOTS_KEPT = 3;

// ── Backend (injectable for tests) ───────────────────────────────────────────

export interface BlobBackend {
  put(pathname: string, body: string | Uint8Array, contentType: string): Promise<void>;
  /** Null when the blob does not exist. */
  get(pathname: string): Promise<Uint8Array | null>;
  /** Pathnames under a prefix, oldest first. */
  list(prefix: string): Promise<string[]>;
  del(pathnames: string[]): Promise<void>;
}

let backendOverride: BlobBackend | null = null;

/** Test seam: replace the Vercel Blob backend with an in-memory fake. */
export function setBlobBackendForTests(backend: BlobBackend | null): void {
  backendOverride = backend;
}

function backend(): BlobBackend {
  if (backendOverride) return backendOverride;
  return {
    async put(pathname, body, contentType) {
      const { put } = await import("@vercel/blob");
      // PutBody accepts Buffer but not a bare Uint8Array — normalize once here
      // so callers (and the test fake) can pass either.
      const payload = typeof body === "string" ? body : Buffer.from(body);
      await put(pathname, payload, {
        access: "private",
        contentType,
        allowOverwrite: pathname === SNAPSHOT_POINTER,
        cacheControlMaxAge: 60,
      });
    },
    async get(pathname) {
      const { get } = await import("@vercel/blob");
      const res = await get(pathname, { access: "private", useCache: false });
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      return new Uint8Array(await new Response(res.stream).arrayBuffer());
    },
    async list(prefix) {
      const { list } = await import("@vercel/blob");
      const names: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const res = (await list({ prefix, limit: 1000, cursor })) as unknown as {
          blobs: Array<{ pathname: string }>;
          cursor?: string;
          hasMore?: boolean;
        };
        for (const b of res.blobs) names.push(b.pathname);
        if (!res.hasMore || !res.cursor) break;
        cursor = res.cursor;
      }
      return names.sort();
    },
    async del(pathnames) {
      if (pathnames.length === 0) return;
      const { del } = await import("@vercel/blob");
      await del(pathnames);
    },
  };
}

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * True when a Blob store is reachable: connected store on Vercel (OIDC via
 * BLOB_STORE_ID) or a read-write token anywhere. `BLOB_SYNC=0` disables.
 */
export function isBlobConfigured(): boolean {
  if (process.env.BLOB_SYNC === "0") return false;
  if (backendOverride) return true;
  return Boolean(process.env.BLOB_STORE_ID ?? process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * True when Blob acts as the offline fallback: a store is reachable and the
 * local-first mirror is disabled (serverless). Long-lived hosts keep pure
 * local-first routing — their on-device file already persists.
 */
export function isBlobServeMode(): boolean {
  if (!isBlobConfigured()) return false;
  return !isLocalFirstEnabled();
}

// ── Op buffer (write path) ───────────────────────────────────────────────────

let opBuffer: OutboxOp[] = [];
let flushScheduled = false;

export function blobPendingOps(): number {
  return opBuffer.length;
}

/**
 * Stage ops for durable upload. Cheap no-op without a store. Uploads are
 * batched: one blob per flush, flushed at request end via `after()` (or
 * explicitly via `flushBlobOps`), so a bulk refresh costs ~1 write.
 */
export function bufferBlobOps(ops: OutboxOp | OutboxOp[]): void {
  if (!isBlobConfigured()) return;
  opBuffer.push(...(Array.isArray(ops) ? ops : [ops]));
  if (opBuffer.length > OP_BUFFER_CAP) opBuffer = opBuffer.slice(-OP_BUFFER_CAP);
  if (opBuffer.length >= 500) {
    void flushBlobOps().catch(() => {});
    return;
  }
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const run = (): void => {
    flushScheduled = false;
    void flushBlobOps().catch(() => {});
  };
  try {
    void import("next/server").then(
      (m) => {
        try {
          m.after(run);
        } catch {
          run(); // no request scope — flush inline
        }
      },
      () => run(),
    );
  } catch {
    run();
  }
}

function opBlobName(): string {
  return `${OPLOG_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`;
}

export interface OpFile {
  v: 1;
  createdAt: string;
  ops: OutboxOp[];
}

/** Upload staged ops as a single blob. Safe to call anywhere; no-ops cheaply. */
export async function flushBlobOps(): Promise<{ uploaded: boolean; opCount: number }> {
  if (opBuffer.length === 0) return { uploaded: false, opCount: 0 };
  const ops = opBuffer;
  opBuffer = [];
  if (!isBlobConfigured()) return { uploaded: false, opCount: 0 }; // nowhere to send
  const file: OpFile = { v: 1, createdAt: new Date().toISOString(), ops };
  const name = opBlobName();
  try {
    await backend().put(name, JSON.stringify(file), "application/json");
    console.log(`[jobradar] blob: buffered ${ops.length} op(s) → ${name}`);
    return { uploaded: true, opCount: ops.length };
  } catch (err) {
    console.warn("[jobradar] blob: op upload failed, will retry:", err instanceof Error ? err.message : err);
    opBuffer = [...ops, ...opBuffer].slice(-OP_BUFFER_CAP);
    return { uploaded: false, opCount: ops.length };
  }
}

// ── Drain (Blob → Neon) ──────────────────────────────────────────────────────

let lastDrainAt = 0;

export interface DrainResult {
  drained: number;
  deleted: number;
  skipped: string | null;
}

function parseOpFile(raw: Uint8Array): OpFile | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as OpFile;
    if (parsed?.v !== 1 || !Array.isArray(parsed.ops)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Replay buffered op blobs into Neon, deleting each fully-replayed blob.
 * Throttled (10 min) and breaker-gated: never lists on hot paths, never
 * waits out a dead remote.
 */
export async function drainBlobOps(opts: { force?: boolean } = {}): Promise<DrainResult> {
  if (!isBlobConfigured()) return { drained: 0, deleted: 0, skipped: "unconfigured" };
  if (!isRemoteConfigured() && !getRemoteHarness()) {
    return { drained: 0, deleted: 0, skipped: "remote-unconfigured" };
  }
  if (!opts.force && Date.now() - lastDrainAt < DRAIN_MIN_INTERVAL_MS) {
    return { drained: 0, deleted: 0, skipped: "throttled" };
  }
  lastDrainAt = Date.now();
  if (!getBreaker().canAttempt()) return { drained: 0, deleted: 0, skipped: "breaker" };

  let names: string[];
  try {
    names = (await backend().list(OPLOG_PREFIX)).filter((n) => n.endsWith(".json"));
  } catch (err) {
    console.warn("[jobradar] blob: oplog list failed:", err instanceof Error ? err.message : err);
    return { drained: 0, deleted: 0, skipped: "list-failed" };
  }
  if (names.length === 0) return { drained: 0, deleted: 0, skipped: null };

  let drained = 0;
  let deleted = 0;
  for (const name of names) {
    let raw: Uint8Array | null;
    try {
      raw = await backend().get(name);
    } catch {
      continue; // transient read — retry next drain
    }
    const file = raw ? parseOpFile(raw) : null;
    if (!file) {
      // corrupt payload can never replay — drop it so the drain isn't stuck
      await backend().del([name]).catch(() => {});
      deleted += 1;
      continue;
    }
    let stopped = false;
    for (const op of file.ops) {
      try {
        await replayOp(op);
        drained += 1;
      } catch (err) {
        const cls = classifyRemoteError(err);
        if (cls === "query") {
          console.error("[jobradar] blob: dropping unplayable op:", err);
          drained += 1;
          continue;
        }
        getBreaker().recordFailure(err, cls);
        stopped = true;
        break;
      }
    }
    if (stopped) break;
    await backend().del([name]).catch(() => {});
    deleted += 1;
  }
  if (drained > 0) getBreaker().recordSuccess();
  if (drained > 0 || deleted > 0) {
    console.log(`[jobradar] blob: drained ${drained} op(s), deleted ${deleted} blob(s)`);
  }
  return { drained, deleted, skipped: null };
}

// ── Snapshot (Neon → Blob → cold starts) ─────────────────────────────────────

interface SnapshotPointer {
  snapshot: string;
  createdAt: string;
}

async function readPointer(): Promise<SnapshotPointer | null> {
  try {
    const raw = await backend().get(SNAPSHOT_POINTER);
    if (!raw) return null;
    const parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as SnapshotPointer;
    if (typeof parsed?.snapshot !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Converge (drain everything to Neon) then publish a fresh snapshot. Runs
 * from the sync route, not per request: it pulls the full dataset once.
 */
export async function uploadSnapshot(): Promise<{ uploaded: boolean; reason: string }> {
  if (!isBlobConfigured()) return { uploaded: false, reason: "unconfigured" };
  if (!isRemoteConfigured() && !getRemoteHarness()) {
    return { uploaded: false, reason: "remote-unconfigured" };
  }
  if (!getBreaker().canAttempt()) return { uploaded: false, reason: "breaker" };

  const store = await getLocalStore({ force: true });
  if (!store) return { uploaded: false, reason: "no-store" };
  const last = store.getMeta("last_snapshot_at");
  if (last && Date.now() - Date.parse(last) < SNAPSHOT_MIN_INTERVAL_MS) {
    return { uploaded: false, reason: "recent" };
  }

  // converge first so the snapshot is a complete copy, not a partial one
  await drainBlobOps({ force: true }).catch(() => {});
  if (store.queueDepth() > 0) {
    const { drainOutbox } = await import("@/db/sync");
    await drainOutbox(store).catch(() => {});
  }
  try {
    const snap = await pullSnapshot();
    store.replaceFromSnapshot(snap);
    getBreaker().recordSuccess();
  } catch (err) {
    const cls = classifyRemoteError(err);
    if (cls !== "query") getBreaker().recordFailure(err, cls);
    return { uploaded: false, reason: "pull-failed" };
  }

  try {
    store.checkpoint();
    const bytes = await readFile(store.path);
    const gz = await gzipAsync(bytes);
    const name = `${SNAPSHOT_PREFIX}${Date.now()}.db.gz`;
    await backend().put(name, new Uint8Array(gz), "application/gzip");
    const pointer: SnapshotPointer = { snapshot: name, createdAt: new Date().toISOString() };
    await backend().put(SNAPSHOT_POINTER, JSON.stringify(pointer), "application/json");
    store.setMeta("last_snapshot_at", pointer.createdAt);
    // prune old snapshots, keep the newest few (names are timestamps)
    const snaps = (await backend().list(SNAPSHOT_PREFIX)).filter((n) => n.endsWith(".db.gz")).sort();
    const stale = snaps.slice(0, Math.max(0, snaps.length - SNAPSHOTS_KEPT));
    if (stale.length > 0) await backend().del(stale).catch(() => {});
    console.log(`[jobradar] blob: snapshot published (${(gz.length / 1024).toFixed(0)} KB) → ${name}`);
    return { uploaded: true, reason: "ok" };
  } catch (err) {
    console.warn("[jobradar] blob: snapshot upload failed:", err instanceof Error ? err.message : err);
    return { uploaded: false, reason: "upload-failed" };
  }
}

async function restoreSnapshotToFile(dbPath: string): Promise<SnapshotPointer | null> {
  const pointer = await readPointer();
  if (!pointer) return null;
  const raw = await backend().get(pointer.snapshot);
  if (!raw) return null;
  const bytes = await gunzipAsync(Buffer.from(raw));
  await mkdir(path.dirname(dbPath), { recursive: true });
  await writeFile(dbPath, bytes);
  return pointer;
}

function appliedOpNames(store: LocalStore): Set<string> {
  try {
    const raw = store.getMeta("applied_blob_ops");
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function rememberAppliedOps(store: LocalStore, names: Set<string>): void {
  try {
    store.setMeta("applied_blob_ops", JSON.stringify([...names].slice(-1000)));
  } catch {
    // bookkeeping must never break serving
  }
}

/**
 * Apply one normalized op to the fallback SQLite mirror (natural keys are
 * re-resolved against local rows). Best-effort per op: a single unplayable
 * op must not stop the rest.
 */
export function applyOpLocal(store: LocalStore, op: OutboxOp): void {
  const localBoardId = (name: string): number | null => {
    const row = store.select("select id from boards where name = ?", [name])[0];
    return row ? Number(row.id) : null;
  };
  const setFields = (fields: Record<string, unknown>, start: number): { clause: string; values: unknown[] } => {
    const entries = Object.entries(fields);
    return {
      clause: entries.map(([c], i) => `${c} = $${start + i}`).join(", "),
      values: entries.map(([, v]) => v),
    };
  };

  switch (op.kind) {
    case "sql":
      store.exec(op.sql, op.params);
      return;
    case "board-insert":
      try {
        store.exec(op.sql, op.params);
      } catch {
        // already present locally — the mirror converges on content, not errors
      }
      return;
    case "board-update": {
      const id = localBoardId(op.name);
      if (id === null) return;
      const { clause, values } = setFields(op.fields, 1);
      if (!clause) return;
      store.exec(`update boards set ${clause} where id = $${values.length + 1}`, [...values, id]);
      return;
    }
    case "board-delete": {
      const id = localBoardId(op.name);
      if (id === null) return;
      store.exec("delete from boards where id = $1", [id]);
      return;
    }
    case "listing-update": {
      const boardId = localBoardId(op.boardName);
      if (boardId === null) return;
      const { clause, values } = setFields(op.fields, 1);
      if (!clause) return;
      store.exec(
        `update listings set ${clause} where board_id = $${values.length + 1} and external_id = $${values.length + 2}${op.onlyWhenUnenriched ? " and skills = '[]'" : ""}`,
        [...values, boardId, op.externalId],
      );
      return;
    }
    case "listings-insert": {
      const boardId = localBoardId(op.boardName);
      if (boardId === null || op.rows.length === 0) return;
      const columns = Object.keys(op.rows[0]);
      const params: unknown[] = [];
      const tuples = op.rows.map((row) => {
        const base = params.length;
        for (const col of columns) params.push(col === "board_id" ? boardId : row[col]);
        return `(${columns.map((_, i) => `$${base + i + 1}`).join(", ")})`;
      });
      try {
        store.exec(
          `insert into listings (${columns.join(", ")}) values ${tuples.join(", ")} on conflict (board_id, external_id) do nothing`,
          params,
        );
      } catch {
        // partial overlap with the snapshot — conflicts are skipped anyway
      }
      return;
    }
    case "api-key-insert":
      try {
        store.exec(
          "insert into api_keys (name, key_hash, prefix, created_at) values ($1, $2, $3, $4) on conflict (key_hash) do nothing",
          [op.name, op.keyHash, op.prefix, op.createdAt],
        );
      } catch {
        // already mirrored
      }
      return;
    case "api-key-update":
      store.exec(
        `update api_keys set ${Object.keys(op.fields)
          .map((c, i) => `${c} = $${i + 1}`)
          .join(", ")} where key_hash = $${Object.keys(op.fields).length + 1}`,
        [...Object.values(op.fields), op.keyHash],
      );
      return;
  }
}

/** Replay op blobs newer than the restored snapshot into the fallback store. */
let lastApplyAt = 0;
const APPLY_MIN_INTERVAL_MS = 60_000;

async function applyNewOpBlobs(store: LocalStore): Promise<number> {
  // listing is an advanced (billed) op — don't do it per query during an
  // outage; the in-request write path applies its own ops locally anyway
  if (Date.now() - lastApplyAt < APPLY_MIN_INTERVAL_MS) return 0;
  lastApplyAt = Date.now();
  const since = store.getMeta("snapshot_created_at");
  const applied = appliedOpNames(store);
  let names: string[];
  try {
    names = (await backend().list(OPLOG_PREFIX)).filter((n) => n.endsWith(".json"));
  } catch {
    return 0;
  }
  let count = 0;
  for (const name of names) {
    if (applied.has(name)) continue;
    const ts = Date.parse(name.slice(OPLOG_PREFIX.length, OPLOG_PREFIX.length + 13));
    if (since && !Number.isNaN(ts) && ts <= Date.parse(since)) {
      applied.add(name); // predates the snapshot — already folded in
      continue;
    }
    let raw: Uint8Array | null = null;
    try {
      raw = await backend().get(name);
    } catch {
      continue;
    }
    const file = raw ? parseOpFile(raw) : null;
    if (!file) continue; // corrupt blobs are the drain's problem, not restore's
    for (const op of file.ops) {
      try {
        applyOpLocal(store, op);
        count += 1;
      } catch {
        // one bad op must not stop the restore
      }
    }
    applied.add(name);
  }
  rememberAppliedOps(store, applied);
  return count;
}

/**
 * Open (or create) the offline fallback store, seeding an empty instance
 * from the latest Blob snapshot plus newer op blobs. Only called after a
 * remote failure, so normal operation never pays for it.
 */
export async function ensureFallbackStore(): Promise<LocalStore | null> {
  if (!isBlobConfigured()) return null;
  const dbPath = localDbPathFromEnv();
  if (!existsSync(dbPath)) {
    try {
      const pointer = await restoreSnapshotToFile(dbPath);
      if (pointer) console.log(`[jobradar] blob: restored snapshot from ${pointer.createdAt}`);
      else console.log("[jobradar] blob: no snapshot available, starting empty fallback");
    } catch (err) {
      console.warn("[jobradar] blob: snapshot restore failed:", err instanceof Error ? err.message : err);
    }
  }
  const store = await getLocalStore({ force: true });
  if (!store) return null;
  // record the snapshot lineage once per file, so op replay has a watermark
  if (!store.getMeta("snapshot_created_at")) {
    const pointer = await readPointer().catch(() => null);
    if (pointer) store.setMeta("snapshot_created_at", pointer.createdAt);
  }
  await applyNewOpBlobs(store).catch(() => {});
  return store;
}

// ── Status & test hooks ──────────────────────────────────────────────────────

export interface BlobStatus {
  configured: boolean;
  serveMode: boolean;
  pendingOps: number;
}

export function blobStatus(): BlobStatus {
  return { configured: isBlobConfigured(), serveMode: isBlobServeMode(), pendingOps: blobPendingOps() };
}

export function resetBlobStateForTests(): void {
  opBuffer = [];
  flushScheduled = false;
  lastDrainAt = 0;
  lastApplyAt = 0;
}
