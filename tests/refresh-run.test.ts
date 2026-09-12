import { beforeEach, describe, expect, it } from "vitest";
import {
  beginRun,
  finishRun,
  getRun,
  isRunActive,
  markBoardDone,
  markBoardStarted,
} from "@/lib/refresh-run";

/** The tracker is a module singleton on globalThis; reset between tests. */
function resetTracker() {
  (globalThis as { __jobradarRefreshRun?: unknown }).__jobradarRefreshRun = undefined;
}

const BOARDS = [
  { id: 1, name: "RemoteOK" },
  { id: 2, name: "We Work Remotely" },
  { id: 3, name: "BDJobs" },
];

describe("refresh run tracker", () => {
  beforeEach(resetTracker);

  it("beginRun creates an active run with every board pending", () => {
    const run = beginRun("manual", BOARDS);

    expect(run).not.toBeNull();
    expect(run!.trigger).toBe("manual");
    expect(run!.finishedAt).toBeNull();
    expect(run!.boards.map((b) => [b.boardId, b.boardName, b.status])).toEqual([
      [1, "RemoteOK", "pending"],
      [2, "We Work Remotely", "pending"],
      [3, "BDJobs", "pending"],
    ]);
    expect(run!.totalInserted).toBe(0);
    expect(isRunActive()).toBe(true);
    expect(getRun()).toBe(run);
  });

  it("beginRun refuses a second run while one is active (single-flight)", () => {
    beginRun("manual", BOARDS);

    expect(beginRun("scheduled", BOARDS)).toBeNull();
    expect(getRun()!.trigger).toBe("manual");
  });

  it("markBoardStarted flags the board as running", () => {
    const run = beginRun("manual", BOARDS)!;

    markBoardStarted(2);

    expect(run!.boards.find((b) => b.boardId === 2)!.status).toBe("running");
    expect(run!.boards.find((b) => b.boardId === 1)!.status).toBe("pending");
  });

  it("markBoardDone records a successful outcome and running total", () => {
    const run = beginRun("manual", BOARDS)!;

    markBoardDone(1, { ok: true, fetched: 42, inserted: 3 });
    markBoardDone(3, { ok: true, fetched: 10, inserted: 5 });

    const first = run.boards.find((b) => b.boardId === 1)!;
    expect(first.status).toBe("ok");
    expect(first.fetched).toBe(42);
    expect(first.inserted).toBe(3);
    expect(first.error).toBeUndefined();
    expect(run.totalInserted).toBe(8);
  });

  it("markBoardDone records a failed outcome with the error message", () => {
    const run = beginRun("manual", BOARDS)!;

    markBoardDone(2, { ok: false, fetched: 0, inserted: 0, error: "boom" });

    const board = run.boards.find((b) => b.boardId === 2)!;
    expect(board.status).toBe("error");
    expect(board.error).toBe("boom");
    expect(run.totalInserted).toBe(0);
  });

  it("finishRun stamps the end time, deactivates, and allows a fresh run", () => {
    beginRun("manual", BOARDS);
    markBoardDone(1, { ok: true, fetched: 5, inserted: 2 });

    finishRun();

    const finished = getRun()!;
    expect(finished.finishedAt).not.toBeNull();
    expect(isRunActive()).toBe(false);

    const second = beginRun("scheduled", BOARDS)!;
    expect(second.trigger).toBe("scheduled");
    expect(second.id).not.toBe(finished.id);
    expect(getRun()).toBe(second);
  });

  it("mark functions are no-ops when no run is active", () => {
    expect(() => markBoardStarted(1)).not.toThrow();
    expect(() => markBoardDone(1, { ok: true, fetched: 1, inserted: 1 })).not.toThrow();
    expect(() => finishRun()).not.toThrow();
    expect(getRun()).toBeNull();
    expect(isRunActive()).toBe(false);
  });

  it("beginRun with no boards still runs and finishes", () => {
    const run = beginRun("manual", [])!;

    expect(run.boards).toEqual([]);
    finishRun();
    expect(isRunActive()).toBe(false);
  });
});
