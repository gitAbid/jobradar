import { q, qOne, run as exec } from "@/db";
import { getDb, getRemoteHarness } from "@/db/remote";
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

/** True while a live (unexpired) refresh lock row exists. */
async function isRefreshLockLive(): Promise<boolean> {
  const row = await qOne<{ live: boolean }>(
    "select ((value::jsonb->>'expiresAt')::timestamptz >= now()) as live " +
      "from app_settings where key = $1",
    [LOCK_KEY],
  );
  return row?.live === true;
}

/** Parse a stored blob into a run, or null when malformed. */
function revive(stored: unknown): StoredRun | null {
  if (typeof stored !== "object" || stored === null) return null;
  const r = stored as StoredRun;
  if (typeof r.id !== "string" || !Array.isArray(r.boards)) return null;
  return r;
}

async function readMirrored(): Promise<RefreshRun | null> {
  try {
    const row = await qOne<{ value: string }>(
      "select value from app_settings where key = $1",
      [RUN_KEY],
    );
    if (!row) return null;
    let run: StoredRun | null;
    try {
      run = revive(JSON.parse(row.value));
    } catch {
      return null;
    }
    if (run === null) return null;
    // an unfinished run whose lock is gone/expired died mid-run (e.g. the
    // function hit maxDuration); report it as ended instead of running forever
    if (run.finishedAt === null && !(await isRefreshLockLive())) {
      return { ...run, finishedAt: run.updatedAt ?? new Date().toISOString() };
    }
    return run;
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

// ── Per-board advisory lock ────────────────────────────────────────────────

/** First half of the two-int advisory-lock key; the board id is the second. */
const BOARD_LOCK_NAMESPACE = 7421;

/**
 * Run `fn` while holding a Postgres advisory lock for `boardId`. Returns
 * `{ locked: false }` without calling `fn` when another session holds it.
 *
 * Session-level locks (pg_try_advisory_lock) are bound to one backend, but
 * postgres.js pools connections (and Neon sits behind a transaction pooler),
 * so a separate lock and unlock statement could land on different backends
 * and leak the lock. Production therefore holds the lock inside one
 * transaction with pg_try_advisory_xact_lock: it is pinned to that
 * transaction's connection and released automatically on commit/rollback
 * (the finally-equivalent, even if `fn` throws). The test harness is a single
 * PGlite session, where pg_try_advisory_lock + pg_advisory_unlock in a
 * finally is equivalent.
 */
export async function withBoardLock<T>(
  boardId: number,
  fn: () => Promise<T>,
): Promise<{ locked: true; value: T } | { locked: false }> {
  const harness = getRemoteHarness();
  if (harness) {
    const [row] = await harness.query("select pg_try_advisory_lock($1::int, $2::int) as ok", [
      BOARD_LOCK_NAMESPACE,
      boardId,
    ]);
    if (row?.ok !== true) return { locked: false };
    try {
      return { locked: true, value: await fn() };
    } finally {
      await harness.query("select pg_advisory_unlock($1::int, $2::int)", [
        BOARD_LOCK_NAMESPACE,
        boardId,
      ]);
    }
  }
  const result = await getDb().begin(async (tx) => {
    const rows = await tx.unsafe("select pg_try_advisory_xact_lock($1::int, $2::int) as ok", [
      BOARD_LOCK_NAMESPACE,
      boardId,
    ]);
    if (rows[0]?.ok !== true) return { locked: false } as const;
    return { locked: true, value: await fn() } as const;
  });
  return result as { locked: true; value: T } | { locked: false };
}
