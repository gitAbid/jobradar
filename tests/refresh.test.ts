import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRun, isRunActive } from "@/lib/refresh-run";
import { refreshAll, startRefreshRun } from "@/lib/refresh";
import { fetchBoardListings } from "@/lib/adapters";
import type { NormalizedListing } from "@/lib/types";

vi.mock("@/db", () => ({
  // q covers the enabled-boards SELECT; qOne the mirrored-run blob read
  // (undefined = no stored run); insertListings the listing upserts; run
  // the board-health UPDATEs, expiry DELETE, and run mirroring
  q: async () => boardRows,
  qOne: async () => undefined,
  insertListings: async (_boardId: number, rows: unknown[]) => rows.length,
  run: async () => 0,
  rowToBoard: (r: Record<string, unknown>) => ({
    id: r.id as number,
    name: r.name as string,
    type: r.type as "api",
    url: r.url as string,
    enabled: true,
    filterKeywords: [],
    lastFetchedAt: null,
    lastStatus: null,
    fetchIntervalHours: null,
  }),
}));

vi.mock("@/lib/adapters", () => ({
  fetchBoardListings: vi.fn(),
}));

const boardRows = [
  { id: 1, name: "Board A", type: "api", url: "https://a.example" },
  { id: 2, name: "Board B", type: "rss", url: "https://b.example" },
];

function listing(n: number): NormalizedListing {
  return {
    externalId: `x-${n}`,
    title: `Job ${n}`,
    company: "Co",
    location: "Remote",
    isRemote: true,
    visaSponsorship: false,
    tags: [],
    url: `https://a.example/${n}`,
    postedAt: null,
    description: "",
  };
}

beforeEach(() => {
  vi.mocked(fetchBoardListings).mockReset();
  (globalThis as { __jobradarRefreshRun?: unknown }).__jobradarRefreshRun = undefined;
});

describe("refreshAll", () => {
  it("refreshes every board and returns a finished summary", async () => {
    vi.mocked(fetchBoardListings).mockImplementation(async (board) =>
      board.id === 1 ? [listing(1), listing(2)] : [listing(3)],
    );

    const summary = await refreshAll(undefined, "manual");

    expect(summary).not.toBeNull();
    expect(summary!.totalInserted).toBe(3);
    expect(summary!.results).toEqual([
      { boardId: 1, boardName: "Board A", ok: true, fetched: 2, inserted: 2 },
      { boardId: 2, boardName: "Board B", ok: true, fetched: 1, inserted: 1 },
    ]);
  });

  it("returns null when another refresh is still in flight", async () => {
    let releaseA!: () => void;
    vi.mocked(fetchBoardListings).mockImplementation(async (board) => {
      if (board.id !== 1) return [];
      return new Promise((resolve) => {
        releaseA = () => resolve([]);
      });
    });

    const first = refreshAll(undefined, "manual");
    const second = await refreshAll(undefined, "manual");

    expect(second).toBeNull(); // single-flight: refused while first is running
    releaseA();
    expect(await first).not.toBeNull();
  });

  it("a failing board never blocks the others and is recorded", async () => {
    vi.mocked(fetchBoardListings).mockImplementation(async (board) => {
      if (board.id === 1) throw new Error("board A down");
      return [listing(1)];
    });

    const summary = await refreshAll(undefined, "scheduled");

    expect(summary!.results[0]).toMatchObject({ boardId: 1, ok: false, error: "board A down" });
    expect(summary!.results[1]).toMatchObject({ boardId: 2, ok: true, inserted: 1 });
    expect(summary!.totalInserted).toBe(1);
  });
});

describe("startRefreshRun", () => {
  it("starts a detached run and refuses a second one", async () => {
    let releaseA!: () => void;
    vi.mocked(fetchBoardListings).mockImplementation(async (board) => {
      if (board.id !== 1) return [];
      return new Promise((resolve) => {
        releaseA = () => resolve([]);
      });
    });

    const started = await startRefreshRun(undefined, "manual");

    expect(started).not.toBeNull();
    expect(started!.run.boards).toHaveLength(2);
    expect(started!.run.trigger).toBe("manual");
    expect(isRunActive()).toBe(true);
    expect(getRun()).toBe(started!.run);

    expect(await startRefreshRun(undefined, "scheduled")).toBeNull(); // refused

    releaseA();
    await started!.done;
    expect(isRunActive()).toBe(false);
  });

  it("finishes the run even when every board fails", async () => {
    vi.mocked(fetchBoardListings).mockRejectedValue(new Error("catastrophic"));

    const started = await startRefreshRun(undefined, "manual");
    expect(started).not.toBeNull();

    await started!.done;
    expect(isRunActive()).toBe(false);
  });
});
