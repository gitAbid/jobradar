import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a) }));
vi.mock("@/lib/adapters", () => ({ fetchBoardListings: vi.fn() }));
vi.mock("@/lib/country-backfill", () => ({ backfillCountries: async () => {} }));

import { setRemoteHarness } from "@/db";
import { fetchBoardListings } from "@/lib/adapters";
import { startScheduledRefresh } from "@/lib/refresh";
import type { NormalizedListing } from "@/lib/types";

function listing(board: number, n: number): NormalizedListing {
  return {
    externalId: `b${board}-${n}`,
    title: `Job ${n}`,
    company: "Co",
    location: "Remote",
    isRemote: true,
    visaSponsorship: false,
    tags: [],
    url: `https://x.example/${board}/${n}`,
    postedAt: null,
    description: "",
  };
}

let db: PGlite;
let lockedBoards: Set<number>;

beforeEach(async () => {
  revalidateTag.mockReset();
  vi.mocked(fetchBoardListings).mockReset();
  (globalThis as { __jobradarRefreshRun?: unknown }).__jobradarRefreshRun = undefined;
  lockedBoards = new Set();
  db = new PGlite();
  for (const f of readdirSync(join(process.cwd(), "db/migrations")).sort())
    if (f.endsWith(".sql")) await db.exec(readFileSync(join(process.cwd(), "db/migrations", f), "utf8"));
  // ids 1..6; stalest first: 3 (never), 5 (never), 2 (oldest), 1, 4; 6 disabled+never
  await db.exec(`
    insert into boards (name, type, url, enabled, last_fetched_at) values
      ('B1','api','http://x', true,  now() - interval '1 hour'),
      ('B2','api','http://x', true,  now() - interval '3 hours'),
      ('B3','api','http://x', true,  null),
      ('B4','api','http://x', true,  now() - interval '10 minutes'),
      ('B5','api','http://x', true,  null),
      ('B6','api','http://x', false, null);
  `);
  setRemoteHarness({
    query: async (sql, params) => {
      // simulate another session holding the advisory lock for some boards
      if (sql.includes("pg_try_advisory_lock") && lockedBoards.has(params[1] as number))
        return [{ ok: false }];
      return (await db.query(sql, params)).rows as Record<string, unknown>[];
    },
    run: async (sql, params) => (await db.query(sql, params)).affectedRows ?? 0,
  });
});
afterEach(() => {
  setRemoteHarness(null);
  delete process.env.REFRESH_BOARDS_PER_TICK;
});

async function tick(limit?: number) {
  const started = await startScheduledRefresh(limit);
  expect(started).not.toBeNull();
  await started!.done;
  return started!;
}

describe("scheduled refresh fan-out", () => {
  it("processes the N most-stale enabled boards, nulls first", async () => {
    const seen: number[] = [];
    vi.mocked(fetchBoardListings).mockImplementation(async (b) => {
      seen.push(b.id);
      return [];
    });
    await tick(4);
    expect(seen).toEqual([3, 5, 2, 1]);
  });

  it("defaults to REFRESH_BOARDS_PER_TICK, then 4", async () => {
    vi.mocked(fetchBoardListings).mockResolvedValue([]);
    process.env.REFRESH_BOARDS_PER_TICK = "2";
    const started = await startScheduledRefresh();
    await started!.done;
    expect(started!.run.boards.map((b) => b.boardId)).toEqual([3, 5]);
  });

  it("skips a board whose advisory lock is held", async () => {
    const seen: number[] = [];
    vi.mocked(fetchBoardListings).mockImplementation(async (b) => {
      seen.push(b.id);
      return [];
    });
    lockedBoards.add(5);
    await tick(4);
    expect(seen).toEqual([3, 2, 1]);
  });

  it("releases the lock after each board (even on failure)", async () => {
    vi.mocked(fetchBoardListings).mockRejectedValue(new Error("down"));
    await tick(2);
    const rows = (await db.query("select count(*)::int as n from pg_locks where locktype = 'advisory'")).rows;
    expect(rows[0]).toEqual({ n: 0 });
  });

  it("invalidates the listings tag once when rows were inserted", async () => {
    vi.mocked(fetchBoardListings).mockImplementation(async (b) => [listing(b.id, 1), listing(b.id, 2)]);
    await tick(3);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("listings", "max");
  });

  it("does not invalidate when nothing changed", async () => {
    vi.mocked(fetchBoardListings).mockResolvedValue([]);
    await tick(3);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("stops starting boards once the time budget is spent", async () => {
    const seen: number[] = [];
    vi.mocked(fetchBoardListings).mockImplementation(async (b) => {
      seen.push(b.id);
      await new Promise((r) => setTimeout(r, 30));
      return [];
    });
    const started = await startScheduledRefresh(4, 20);
    await started!.done;
    expect(seen).toEqual([3]);
  });
});
