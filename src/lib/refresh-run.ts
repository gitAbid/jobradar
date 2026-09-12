export type RefreshTrigger = "manual" | "scheduled";

export type RefreshRunBoardStatus = "pending" | "running" | "ok" | "error";

export interface RefreshRunBoard {
  boardId: number;
  boardName: string;
  status: RefreshRunBoardStatus;
  fetched: number;
  inserted: number;
  error?: string;
}

export interface RefreshRun {
  id: string;
  trigger: RefreshTrigger;
  startedAt: string;
  finishedAt: string | null;
  boards: RefreshRunBoard[];
  totalInserted: number;
}

declare const globalThis: { __jobradarRefreshRun?: RefreshRun };

/**
 * In-memory tracker for the currently running (or last finished) refresh.
 * Single source of truth for the progress UI; survives client navigation
 * and reloads because clients poll it — but not server restarts.
 */
export function getRun(): RefreshRun | null {
  return globalThis.__jobradarRefreshRun ?? null;
}

export function isRunActive(): boolean {
  const run = getRun();
  return run !== null && run.finishedAt === null;
}

/** Start a new run; null when another run is still in flight. */
export function beginRun(
  trigger: RefreshTrigger,
  boards: ReadonlyArray<{ id: number; name: string }>,
): RefreshRun | null {
  if (isRunActive()) return null;
  const run: RefreshRun = {
    id: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    trigger,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalInserted: 0,
    boards: boards.map((b) => ({
      boardId: b.id,
      boardName: b.name,
      status: "pending",
      fetched: 0,
      inserted: 0,
    })),
  };
  globalThis.__jobradarRefreshRun = run;
  return run;
}

function activeBoard(boardId: number): RefreshRunBoard | undefined {
  const run = getRun();
  if (!run || run.finishedAt !== null) return undefined;
  return run.boards.find((b) => b.boardId === boardId);
}

export function markBoardStarted(boardId: number): void {
  const board = activeBoard(boardId);
  if (board) board.status = "running";
}

export function markBoardDone(
  boardId: number,
  outcome: { ok: boolean; fetched: number; inserted: number; error?: string },
): void {
  const board = activeBoard(boardId);
  if (!board) return;
  board.status = outcome.ok ? "ok" : "error";
  board.fetched = outcome.fetched;
  board.inserted = outcome.inserted;
  if (outcome.error) board.error = outcome.error;
  const run = getRun()!;
  run.totalInserted = run.boards.reduce((n, b) => n + b.inserted, 0);
}

export function finishRun(): void {
  const run = getRun();
  if (!run || run.finishedAt !== null) return;
  run.finishedAt = new Date().toISOString();
}
