import { insertListings, q, rowToBoard, run } from "@/db";
import { fetchBoardListings } from "@/lib/adapters";
import { sanitizeTags, capDescription } from "@/lib/adapters/normalize";
import { buildSearchText } from "@/lib/filters";
import { extractSkills } from "@/lib/skills";
import {
  beginTrackedRun,
  completeTrackedBoard,
  finishTrackedRun,
  startTrackedBoard,
} from "@/lib/refresh-run-store";
import type { RefreshRun, RefreshTrigger } from "@/lib/refresh-run";
import type { Board, NormalizedListing } from "@/lib/types";

export interface BoardRefreshOutcome {
  boardId: number;
  boardName: string;
  ok: boolean;
  fetched: number;
  inserted: number;
  error?: string;
}

export interface RefreshSummary {
  ranAt: string;
  results: BoardRefreshOutcome[];
  totalInserted: number;
}

/** A started run plus the promise that settles when all boards are done. */
export interface StartedRefreshRun {
  run: RefreshRun;
  done: Promise<void>;
}

async function loadEnabledBoards(boardId?: number): Promise<Board[]> {
  const rows = await q<Record<string, unknown>>(
    `select b.* from boards b
     where ($1::int is null or b.id = $1) and b.enabled = 1`,
    [boardId ?? null],
  );
  return rows.map((r) => rowToBoard(r as never));
}

/** Run the already-begun tracked run to completion; never leaves it stuck active. */
async function executeRun(boards: Board[]): Promise<RefreshSummary> {
  try {
    // fetch boards concurrently; each board writes its own rows and the
    // driver serializes statements over its small connection pool
    const results = await Promise.all(
      boards.map(async (board) => {
        startTrackedBoard(board.id);
        const outcome = await refreshBoard(board);
        await completeTrackedBoard(board.id, outcome);
        return outcome;
      }),
    );

    await expireOldListings();

    return {
      ranAt: new Date().toISOString(),
      results,
      totalInserted: results.reduce((n, r) => n + r.inserted, 0),
    };
  } finally {
    await finishTrackedRun();
  }
}

/**
 * Fetch every enabled board (or just one), upsert listings, update health.
 * One failing board never blocks the others.
 * Returns null when another refresh is still in flight (single-flight).
 */
export async function refreshAll(
  boardId?: number,
  trigger: RefreshTrigger = "manual",
): Promise<RefreshSummary | null> {
  const boards = await loadEnabledBoards(boardId);
  if ((await beginTrackedRun(trigger, boards)) === null) return null;
  return executeRun(boards);
}

/**
 * Begin a refresh and return immediately with the tracked run. The caller
 * keeps the invocation alive by awaiting `done` inside `after()` — on
 * serverless the run must outlive the HTTP response. Returns null when
 * refused because another run is in flight.
 */
export async function startRefreshRun(
  boardId: number | undefined,
  trigger: RefreshTrigger = "manual",
): Promise<StartedRefreshRun | null> {
  const boards = await loadEnabledBoards(boardId);
  const run = await beginTrackedRun(trigger, boards);
  if (run === null) return null;
  const done = executeRun(boards)
    .then(() => undefined)
    .catch((err) => {
      console.error("[jobradar] refresh run crashed:", err);
    });
  return { run, done };
}

export async function refreshBoard(
  board: Pick<Board, "id" | "name" | "type" | "url" | "filterKeywords">,
): Promise<BoardRefreshOutcome> {
  try {
    const listings = sanitizeTags(await fetchBoardListings(board));
    const inserted = await upsertListings(board.id, listings);
    await run("update boards set last_fetched_at = $1, last_status = $2 where id = $3", [
      new Date().toISOString(),
      `ok · ${listings.length} fetched`,
      board.id,
    ]);
    return { boardId: board.id, boardName: board.name, ok: true, fetched: listings.length, inserted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // board may have been deleted mid-refresh — keep the failure reportable
    await run("update boards set last_fetched_at = $1, last_status = $2 where id = $3", [
      new Date().toISOString(),
      `error · ${msg.slice(0, 180)}`,
      board.id,
    ]).catch(() => {});
    return { boardId: board.id, boardName: board.name, ok: false, fetched: 0, inserted: 0, error: msg };
  }
}

async function upsertListings(boardId: number, listings: NormalizedListing[]): Promise<number> {
  const fetchedAt = new Date().toISOString();
  return insertListings(
    boardId,
    listings.map((l) => ({
      externalId: l.externalId,
      title: l.title,
      company: l.company,
      location: l.location,
      isRemote: l.isRemote,
      visaSponsorship: l.visaSponsorship,
      remoteScope: l.remoteScope ?? null,
      tags: JSON.stringify(l.tags),
      skills: JSON.stringify(
        extractSkills({ title: l.title, tags: l.tags, description: l.description }),
      ),
      url: l.url,
      postedAt: l.postedAt,
      deadline: l.deadline ?? null,
      fetchedAt,
      searchText: buildSearchText({
        title: l.title,
        company: l.company,
        location: l.location,
        tags: l.tags,
        description: l.description,
      }),
      description: capDescription(l.description),
    })),
  );
}

/** Remove non-saved listings not refetched in 45 days (applied/favorite are kept). */
async function expireOldListings(): Promise<void> {
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  await run("delete from listings where status = 'new' and fetched_at < $1", [cutoff]);
}
