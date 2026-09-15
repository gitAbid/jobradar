import {
  classifyRemoteError,
  type RemoteErrorClass,
} from "@/db/translate";
import { getBreaker, type CircuitBreaker } from "@/db/remote-health";
import { isRemoteConfigured, probeRemote, remoteQuery, remoteRun } from "@/db/remote";
import { getLocalStore, type LocalStore, type QueueEntry, type Snapshot } from "@/db/local-store";
import type { OutboxOp } from "@/db/outbox";

/**
 * Sync engine between the on-device store and Neon.
 *
 *  - Reads never wait on the network: they are served from the local mirror,
 *    refreshed by `ensureFreshLocal` (initial hydration, then a catch-up pull
 *    at most every CATCHUP_TTL_MS while the remote is healthy).
 *  - Writes captured while the remote was unreachable sit in the local outbox
 *    queue; `drainOutbox` replays them in FIFO order (causality preserved)
 *    once the remote answers again. Ops carry natural keys (board name,
 *    listing (board, external_id), api key hash) and re-resolve remote row
 *    ids at replay — see outbox.ts.
 */

const CATCHUP_TTL_MS = 120_000;

function isOpEntry(entry: QueueEntry): entry is QueueEntry & { payload: OutboxOp } {
  return entry.kind === "op" && typeof entry.payload === "object" && entry.payload !== null;
}

// ── Outbox drain (local → remote) ──────────────────────────────────────────

async function remoteBoardId(name: string): Promise<number | null> {
  const rows = await remoteQuery<{ id: number }>("select id from boards where name = $1", [name]);
  const id = rows[0]?.id;
  return id === undefined || id === null ? null : Number(id);
}

async function remoteListingId(
  boardId: number,
  externalId: string,
): Promise<number | null> {
  const rows = await remoteQuery<{ id: number }>(
    "select id from listings where board_id = $1 and external_id = $2",
    [boardId, externalId],
  );
  const id = rows[0]?.id;
  return id === undefined || id === null ? null : Number(id);
}

function drop(reason: string): void {
  console.warn(`[jobradar] sync: dropping queued op — ${reason}`);
}

/** Replay one normalized op. Throws on connection/limit errors to stop the drain. */
async function replayOp(op: OutboxOp): Promise<void> {
  switch (op.kind) {
    case "sql":
      await remoteRun(op.sql, op.params);
      return;
    case "board-insert": {
      await remoteRun(op.sql, op.params);
      return;
    }
    case "board-update": {
      const id = await remoteBoardId(op.name);
      if (id === null) return drop(`board ${op.name} not found remotely`);
      const fields = Object.entries(op.fields);
      await remoteRun(
        `update boards set ${fields.map(([c], i) => `${c} = $${i + 1}`).join(", ")} where id = $${fields.length + 1}`,
        [...fields.map(([, v]) => v), id],
      );
      return;
    }
    case "board-delete": {
      const id = await remoteBoardId(op.name);
      if (id === null) return drop(`board ${op.name} not found remotely`);
      await remoteRun("delete from boards where id = $1", [id]);
      return;
    }
    case "listing-update": {
      const boardId = await remoteBoardId(op.boardName);
      if (boardId === null) return drop(`board ${op.boardName} not found remotely`);
      const listingId = await remoteListingId(boardId, op.externalId);
      if (listingId === null)
        return drop(`listing ${op.externalId} (${op.boardName}) not found remotely`);
      const fields = Object.entries(op.fields);
      await remoteRun(
        `update listings set ${fields.map(([c], i) => `${c} = $${i + 1}`).join(", ")} where id = $${fields.length + 1}${op.onlyWhenUnenriched ? " and skills = '[]'" : ""}`,
        [...fields.map(([, v]) => v), listingId],
      );
      return;
    }
    case "listings-insert": {
      const boardId = await remoteBoardId(op.boardName);
      if (boardId === null) return drop(`board ${op.boardName} not found remotely`);
      const columns = Object.keys(op.rows[0] ?? {});
      if (columns.length === 0) return;
      const params: unknown[] = [];
      const tuples = op.rows.map((row) => {
        const base = params.length;
        for (const col of columns) params.push(row[col]);
        return `(${columns.map((_, i) => `$${base + i + 1}`).join(", ")})`;
      });
      await remoteRun(
        `insert into listings (${columns.join(", ")}) values ${tuples.join(", ")}
         on conflict (board_id, external_id) do nothing`,
        params,
      );
      return;
    }
    case "api-key-update": {
      const rows = await remoteQuery<{ id: number }>(
        "select id from api_keys where key_hash = $1",
        [op.keyHash],
      );
      const id = rows[0]?.id;
      if (id === undefined || id === null) return drop(`api key ${op.keyHash} not found remotely`);
      const fields = Object.entries(op.fields);
      await remoteRun(
        `update api_keys set ${fields.map(([c], i) => `${c} = $${i + 1}`).join(", ")} where id = $${fields.length + 1}`,
        [...fields.map(([, v]) => v), id],
      );
      return;
    }
  }
}

export async function drainOutbox(
  store: LocalStore,
): Promise<{ drained: number; remaining: number }> {
  let drained = 0;
  // bounded loop: each pass takes a batch; a connection failure stops it
  for (;;) {
    const batch = store.readQueue(200);
    if (batch.length === 0) break;
    let stopped = false;
    for (const entry of batch) {
      try {
        if (isOpEntry(entry)) {
          await replayOp(entry.payload);
        } else {
          const p = entry.payload as { sql: string; params: unknown[] };
          await remoteRun(p.sql, p.params);
        }
        store.deleteQueued([entry.id]);
        drained += 1;
      } catch (err) {
        const cls: RemoteErrorClass = classifyRemoteError(err);
        if (cls === "query") {
          // a real bug/constraint conflict: replaying can never succeed, so
          // drop the statement (logged) and keep draining the rest
          console.error("[jobradar] sync: dropping unplayable queued statement:", err);
          store.deleteQueued([entry.id]);
          drained += 1;
          continue;
        }
        getBreaker().recordFailure(err, cls);
        stopped = true;
        break;
      }
    }
    if (stopped) break;
  }
  return { drained, remaining: store.queueDepth() };
}

// ── Remote → local hydration ───────────────────────────────────────────────

declare const globalThis: {
  __jobradarHydrateChain?: Promise<boolean>;
  __jobradarSyncTimer?: ReturnType<typeof setInterval>;
};

async function pullSnapshot(): Promise<Snapshot> {
  const [boards, listings, appSettings, followedCompanies, pinnedCountries, apiKeys] =
    await Promise.all([
      remoteQuery("select * from boards"),
      remoteQuery("select * from listings"),
      remoteQuery<{ key: string; value: string }>("select key, value from app_settings"),
      remoteQuery<{ name: string; created_at: string }>(
        "select name, created_at from followed_companies",
      ),
      remoteQuery<{ name: string; created_at: string }>(
        "select name, created_at from pinned_countries",
      ),
      remoteQuery<Record<string, unknown>>("select * from api_keys").catch(() => []),
    ]);
  return { boards, listings, appSettings, followedCompanies, pinnedCountries, apiKeys };
}

/**
 * Pull the remote dataset into the local mirror. Single-flighted per process.
 * The outbox is drained first so locally-made changes win on the remote
 * before the wipe-and-copy refreshes the mirror.
 */
export function hydrateFromRemote(reason: string): Promise<boolean> {
  const inflight = globalThis.__jobradarHydrateChain;
  if (inflight) return inflight;
  const task = (async () => {
    const store = await getLocalStore();
    if (!store || !isRemoteConfigured()) return false;
    if (!getBreaker().canAttempt()) return false;
    try {
      if (store.queueDepth() > 0) await drainOutbox(store);
      const snap = await pullSnapshot();
      store.replaceFromSnapshot(snap);
      getBreaker().recordSuccess();
      console.log(
        `[jobradar] local mirror synced from remote (${reason}): ${snap.listings.length} listings`,
      );
      return true;
    } catch (err) {
      const cls = classifyRemoteError(err);
      if (cls === "query") {
        console.error("[jobradar] hydration failed (query error):", err);
      } else {
        getBreaker().recordFailure(err, cls);
      }
      return false;
    }
  })().finally(() => {
    globalThis.__jobradarHydrateChain = undefined;
  });
  globalThis.__jobradarHydrateChain = task;
  return task;
}

/**
 * Read-path freshness gate, called before serving local reads:
 *  - breaker open → serve local as-is (offline mode)
 *  - never hydrated → block on initial hydration (nothing cached yet)
 *  - hydrated but stale → throttled catch-up pull
 * Recovery after an outage flows through here naturally: once the backoff
 * window elapses, the next read (or background tick) attempts the pull and
 * either heals the mirror or re-arms the breaker.
 */
export async function ensureFreshLocal(): Promise<void> {
  const store = await getLocalStore();
  if (!store) return;
  if (!isRemoteConfigured()) {
    // stand-alone mode: make sure a fresh store has its default boards
    store.seedBoardsIfEmpty();
    return;
  }
  const last = store.getMeta("last_hydrated_at");
  if (!getBreaker().canAttempt()) {
    // offline and nothing cached yet — seed the default boards so a
    // brand-new install can still refresh sources while the remote is down
    if (last === null) store.seedBoardsIfEmpty();
    return;
  }

  if (last === null) {
    await hydrateFromRemote("initial");
    return;
  }
  if (Date.now() - Date.parse(last) > CATCHUP_TTL_MS) {
    await hydrateFromRemote("catchup");
  }
}

/**
 * Explicit recovery probe (write path / status endpoint / background tick):
 * when the backoff window has elapsed, ping the remote; on success drain the
 * outbox and refresh the mirror.
 */
export async function tryRecover(): Promise<boolean> {
  if (!isRemoteConfigured()) return false;
  const breaker = getBreaker();
  if (breaker.isOpen || breaker.status().state === "up") return breaker.status().state === "up";
  try {
    await probeRemote();
  } catch (err) {
    const cls = classifyRemoteError(err);
    if (cls !== "query") breaker.recordFailure(err, cls);
    return false;
  }
  breaker.recordSuccess();
  const store = await getLocalStore();
  if (store) {
    if (store.queueDepth() > 0) await drainOutbox(store);
    await hydrateFromRemote("recovery");
  }
  return true;
}

// ── Background tick for long-lived processes (local dev, containers) ───────

export function initBackgroundSync(): void {
  if (globalThis.__jobradarSyncTimer) return;
  void getLocalStore().then((store) => {
    if (!store) return;
    // warm the mirror without blocking boot
    void ensureFreshLocal().catch(() => {});
    globalThis.__jobradarSyncTimer = setInterval(() => {
      void (async () => {
        const s = await getLocalStore();
        if (!s) return;
        if (s.queueDepth() > 0 && getBreaker().canAttempt()) {
          if (getBreaker().status().state === "down") await tryRecover();
          else await drainOutbox(s);
        }
        await ensureFreshLocal();
      })().catch(() => {});
    }, 60_000);
    globalThis.__jobradarSyncTimer.unref();
    console.log(`[jobradar] on-device store ready at ${store.path}`);
  });
}

// ── Status surface (badge + /api/db-status) ────────────────────────────────

export interface DbStatus {
  mode: "local-first" | "remote-direct";
  remote: "up" | "down" | "unconfigured";
  remoteConfigured: boolean;
  breaker: ReturnType<CircuitBreaker["status"]>;
  queueDepth: number;
  local: {
    available: boolean;
    path: string | null;
    lastHydratedAt: string | null;
    boards: number;
    listings: number;
  };
}

export async function dbStatus(): Promise<DbStatus> {
  const store = await getLocalStore();
  const breaker = getBreaker();
  const configured = isRemoteConfigured();
  return {
    mode: store ? "local-first" : "remote-direct",
    remote: !configured ? "unconfigured" : breaker.isOpen ? "down" : "up",
    remoteConfigured: configured,
    breaker: breaker.status(),
    queueDepth: store?.queueDepth() ?? 0,
    local: {
      available: Boolean(store),
      path: store?.path ?? null,
      lastHydratedAt: store?.getMeta("last_hydrated_at") ?? null,
      boards: store?.counts().boards ?? 0,
      listings: store?.counts().listings ?? 0,
    },
  };
}

export function resetSyncStateForTests(): void {
  globalThis.__jobradarHydrateChain = undefined;
  if (globalThis.__jobradarSyncTimer) {
    clearInterval(globalThis.__jobradarSyncTimer);
    globalThis.__jobradarSyncTimer = undefined;
  }
}
