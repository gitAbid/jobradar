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
  withBoardLock,
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
     where ($1::int is null or b.id = $1) and b.enabled`,
    [boardId ?? null],
  );
  return rows.map((r) => rowToBoard(r as never));
}

const DEFAULT_BOARDS_PER_TICK = 4;
/** Stop starting new boards this long after a scheduled tick begins; the cron
 * route's maxDuration is 60s, leaving room for the in-flight board + cleanup. */
const TICK_START_BUDGET_MS = 40_000;

export function boardsPerTick(): number {
  const n = Number.parseInt(process.env.REFRESH_BOARDS_PER_TICK ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_BOARDS_PER_TICK;
}

interface ScheduledOptions {
  /** Epoch ms after which no further board is started. */
  deadline: number;
}

/** Run the already-begun tracked run to completion; never leaves it stuck active. */
async function executeRun(boards: Board[], scheduled?: ScheduledOptions): Promise<RefreshSummary> {
  let changed = false;
  try {
    let results: BoardRefreshOutcome[];
    if (scheduled) {
      // scheduled ticks go one board at a time: each holds a pooled connection
      // for its advisory lock, and the time budget is checked between boards
      results = [];
      for (const board of boards) {
        if (Date.now() >= scheduled.deadline) break;
        startTrackedBoard(board.id);
        const locked = await withBoardLock(board.id, () => refreshBoard(board));
        const outcome: BoardRefreshOutcome = locked.locked
          ? locked.value
          : {
              boardId: board.id,
              boardName: board.name,
              ok: false,
              fetched: 0,
              inserted: 0,
              error: "skipped: board is being refreshed elsewhere",
            };
        await completeTrackedBoard(board.id, outcome);
        if (locked.locked) results.push(outcome);
      }
    } else {
      // fetch boards concurrently; each board writes its own rows and the
      // driver serializes statements over its small connection pool
      results = await Promise.all(
        boards.map(async (board) => {
          startTrackedBoard(board.id);
          const outcome = await refreshBoard(board);
          await completeTrackedBoard(board.id, outcome);
          return outcome;
        }),
      );
    }

    const expired = await expireOldListings();
    changed = expired > 0 || results.some((r) => r.inserted > 0);

    return {
      ranAt: new Date().toISOString(),
      results,
      totalInserted: results.reduce((n, r) => n + r.inserted, 0),
    };
  } finally {
    await finishTrackedRun();
    // precompute country for new rows so the feed query skips its CASE
    try {
      const [{ backfillCountries }, { remoteQuery }] = await Promise.all([
        import("@/lib/country-backfill"),
        import("@/db/remote"),
      ]);
      await backfillCountries((text, values) => remoteQuery(text, values));
    } catch (err) {
      console.error("[jobradar] country backfill failed:", err);
    }
    // shared listings cache: serve stale-while-revalidate until next read.
    // Once per run, and only when rows changed. Runs inside after() (not a
    // documented request scope) so never throw.
    if (changed) {
      try {
        const { revalidateTag } = await import("next/cache");
        revalidateTag("listings", "max");
      } catch (err) {
        console.error("[jobradar] revalidateTag(listings) failed:", err);
      }
    }
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

/**
 * Begin a scheduled tick: refresh the N most-stale enabled boards (oldest
 * last fetch first, never-fetched first), one at a time under a per-board
 * advisory lock, and stop starting boards once the time budget runs low.
 * Returns null when another run is in flight.
 */
export async function startScheduledRefresh(
  limit: number = boardsPerTick(),
  budgetMs: number = TICK_START_BUDGET_MS,
): Promise<StartedRefreshRun | null> {
  const deadline = Date.now() + budgetMs;
  const rows = await q<Record<string, unknown>>(
    `select b.* from boards b
     where b.enabled
     order by b.last_fetched_at asc nulls first, b.id asc
     limit $1::int`,
    [limit],
  );
  const boards = rows.map((r) => rowToBoard(r as never));
  const run = await beginTrackedRun("scheduled", boards);
  if (run === null) return null;
  const done = executeRun(boards, { deadline })
    .then(() => undefined)
    .catch((err) => {
      console.error("[jobradar] scheduled refresh crashed:", err);
    });
  return { run, done };
}

export async function refreshBoard(
  board: Pick<Board, "id" | "name" | "type" | "url" | "filterKeywords">,
): Promise<BoardRefreshOutcome> {
  try {
    const listings = sanitizeTags(await fetchBoardListings(board));
    const inserted = await upsertListings(board.id, listings);
    await run("update boards set last_fetched_at = $1::timestamptz, last_status = $2 where id = $3", [
      new Date().toISOString(),
      `ok · ${listings.length} fetched`,
      board.id,
    ]);
    return { boardId: board.id, boardName: board.name, ok: true, fetched: listings.length, inserted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // board may have been deleted mid-refresh — keep the failure reportable
    await run("update boards set last_fetched_at = $1::timestamptz, last_status = $2 where id = $3", [
      new Date().toISOString(),
      `error · ${msg.slice(0, 180)}`,
      board.id,
    ]).catch(() => {});
    return { boardId: board.id, boardName: board.name, ok: false, fetched: 0, inserted: 0, error: msg };
  }
}

/** Only absolute http(s) URLs are stored; anything else (javascript:, data:, relative) is dropped. */
function isHttpUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

async function upsertListings(boardId: number, listings: NormalizedListing[]): Promise<number> {
  const fetchedAt = new Date().toISOString();
  return insertListings(
    boardId,
    listings.filter((l) => isHttpUrl(l.url)).map((l) => ({
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

/**
 * Remove listings not refetched in 45 days, unless any user has saved them
 * (status other than 'new') or they carry unclaimed legacy state.
 */
export async function expireOldListings(): Promise<number> {
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  return run(
    `delete from listings l
      where l.fetched_at < $1::timestamptz
        and not exists (select 1 from user_listing_state s where s.listing_id = l.id
                          and (s.status in ('favorite','applied') or s.user_tags <> '[]'::jsonb))
        and (exists (select 1 from app_settings where key = 'legacy_claimed')
             or not exists (select 1 from legacy_listing_state g where g.listing_id = l.id
                              and (g.status in ('favorite','applied') or g.user_tags <> '[]'::jsonb)))`,
    [cutoff],
  );
}
