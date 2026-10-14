import { q, qOne, run as exec } from "@/db";
import {
  beginRun,
  finishRun,
  getRun,
  isRunActive,
  markBoardDone,
  markBoardStarted,
} from "@/lib/refresh-run";
import type { RefreshRun, RefreshTrigger } from "@/lib/refresh-run";

/**
 * The in-memory run tracker (refresh-run.ts) is per-instance, so on
 * serverless the instance serving /api/refresh/status can't see the run
 * executing on another instance — the progress bar shows nothing. This
 * store mirrors every tracker mutation into app_settings, making the live
 * run visible from any instance.
 *
 * The executing instance's memory stays the write-side authority; mirror
 * writes are serialized through a chained promise so concurrent board
 * completions can't clobber each other within the instance. Cross-instance
 * writes never race because only the instance executing the run writes.
 */

const RUN_KEY = "refresh_run";
/** A run with no update for this long is considered dead (e.g. the
 * function hit maxDuration mid-run) rather than blocking new runs. */
const STALE_MS = 5 * 60 * 1000;

const LOCK_KEY = "refresh_lock";
/** Refresh routes cap at maxDuration = 60s; the lock outlives that by a margin
 * so a crashed run's lock expires on its own but a live run never loses it. */
const LOCK_TTL_MS = (60 + 30) * 1000;

interface StoredRun extends RefreshRun {
  updatedAt?: string;
}

declare const globalThis: {
  __jobradarMirrorChain?: Promise<unknown>;
  __jobradarRefreshLockToken?: string;
};

/**
 * Atomically take the cross-instance refresh lock (one statement, so no
 * read-then-write race). Session advisory locks don't survive the PgBouncer
 * transaction pooler, hence a lock row with expiry. Returns the owner token,
 * or null when another live run holds it.
 */
export async function acquireRefreshLock(ttlMs: number = LOCK_TTL_MS): Promise<string | null> {
  const token = crypto.randomUUID();
  const value = JSON.stringify({
    token,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  });
  const rows = await q<{ key: string }>(
    "insert into app_settings (key, value) values ($1, $2) " +
      "on conflict (key) do update set value = excluded.value " +
      "where (app_settings.value::jsonb->>'expiresAt')::timestamptz < now() " +
      "returning key",
    [LOCK_KEY, value],
  );
  return rows.length > 0 ? token : null;
}

/** Release the lock; only the owner's token matches. */
export async function releaseRefreshLock(token: string): Promise<void> {
  await exec(
    "delete from app_settings where key = $1 and value::jsonb->>'token' = $2",
    [LOCK_KEY, token],
  );
}

function mirror(run: RefreshRun): Promise<unknown> {
  const stored: StoredRun = { ...run, updatedAt: new Date().toISOString() };
  const write = (globalThis.__jobradarMirrorChain ?? Promise.resolve())
    .then(() =>
      exec(
        "insert into app_settings (key, value) values ($1, $2) " +
          "on conflict (key) do update set value = excluded.value",
        [RUN_KEY, JSON.stringify(stored)],
      ),
    )
    .catch(() => {
      // mirroring is best-effort; local progress still works via memory
    });
  globalThis.__jobradarMirrorChain = write;
  return write;
}

/** Parse a stored blob; patches runs whose instance died mid-run as ended. */
function revive(stored: unknown): RefreshRun | null {
  if (typeof stored !== "object" || stored === null) return null;
  const r = stored as StoredRun;
  if (typeof r.id !== "string" || !Array.isArray(r.boards)) return null;
  if (
    r.finishedAt === null &&
    typeof r.updatedAt === "string" &&
    Date.now() - Date.parse(r.updatedAt) > STALE_MS
  ) {
    return { ...r, finishedAt: r.updatedAt };
  }
  return r;
}

async function readMirrored(): Promise<RefreshRun | null> {
  try {
    const row = await qOne<{ value: string }>(
      "select value from app_settings where key = $1",
      [RUN_KEY],
    );
    if (!row) return null;
    try {
      return revive(JSON.parse(row.value));
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Begin a run unless one is already active — on this instance (memory) or
 * on another one (fresh mirror). Returns the begun run, or null when
 * refused (single-flight).
 */
export async function beginTrackedRun(
  trigger: RefreshTrigger,
  boards: ReadonlyArray<{ id: number; name: string }>,
): Promise<RefreshRun | null> {
  if (isRunActive()) return null;
  let token: string | null;
  try {
    token = await acquireRefreshLock();
  } catch (err) {
    console.error("[jobradar] refresh lock acquire failed:", err);
    return null; // fail closed
  }
  if (token === null) return null;
  const run = beginRun(trigger, boards);
  if (run === null) {
    await releaseRefreshLock(token).catch(() => {});
    return null;
  }
  globalThis.__jobradarRefreshLockToken = token;
  mirror(run);
  return run;
}

export function startTrackedBoard(boardId: number): void {
  markBoardStarted(boardId);
  const run = getRun();
  if (run !== null) mirror(run);
}

export async function completeTrackedBoard(
  boardId: number,
  outcome: { ok: boolean; fetched: number; inserted: number; error?: string },
): Promise<void> {
  markBoardDone(boardId, outcome);
  const run = getRun();
  if (run !== null) await mirror(run);
}

export async function finishTrackedRun(): Promise<void> {
  finishRun();
  const token = globalThis.__jobradarRefreshLockToken;
  globalThis.__jobradarRefreshLockToken = undefined;
  if (token !== undefined) {
    await releaseRefreshLock(token).catch((err) => {
      console.error("[jobradar] refresh lock release failed:", err);
    });
  }
  const run = getRun();
  if (run !== null) await mirror(run);
}

/**
 * Live run for status polling: this instance's memory first (fast and
 * authoritative while executing), then the mirror (other instances).
 */
export async function readCurrentRun(): Promise<RefreshRun | null> {
  return getRun() ?? (await readMirrored());
}
