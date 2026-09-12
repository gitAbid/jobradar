import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RefreshRun } from "@/lib/refresh-run";
import {
  dismissFinished,
  getState,
  pollStatus,
  startRefresh,
} from "@/lib/refresh-client";

const activeRun: RefreshRun = {
  id: "r1",
  trigger: "manual",
  startedAt: "2026-08-29T10:00:00.000Z",
  finishedAt: null,
  totalInserted: 0,
  boards: [
    { boardId: 1, boardName: "A", status: "ok", fetched: 2, inserted: 1 },
    { boardId: 2, boardName: "B", status: "running", fetched: 0, inserted: 0 },
  ],
};

const finishedRun: RefreshRun = {
  ...activeRun,
  id: "r2",
  finishedAt: "2026-08-29T10:01:00.000Z",
  totalInserted: 4,
};

function resetStore() {
  (globalThis as { __jobradarRefreshClient?: unknown }).__jobradarRefreshClient = undefined;
}

function stubFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body,
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetStore();
  vi.unstubAllGlobals();
});

describe("refresh client store", () => {
  it("pollStatus stores the run from the status endpoint", async () => {
    stubFetch([{ body: { run: activeRun } }]);

    await pollStatus();

    expect(getState().run).toEqual(activeRun);
    expect(getState().completedRunId).toBeNull();
  });

  it("marks a completion only when a run is observed going active → finished", async () => {
    stubFetch([{ body: { run: activeRun } }, { body: { run: finishedRun } }]);

    await pollStatus();
    await pollStatus();

    expect(getState().completedRunId).toBe("r2");
  });

  it("does not mark a completion for a run already finished on first sight", async () => {
    stubFetch([{ body: { run: finishedRun } }]);

    await pollStatus();

    expect(getState().run).toEqual(finishedRun);
    expect(getState().completedRunId).toBeNull();
  });

  it("keeps the last known state when the status endpoint fails", async () => {
    const fetchMock = stubFetch([{ body: { run: activeRun } }]);
    await pollStatus();
    fetchMock.mockRejectedValueOnce(new Error("server restarting"));

    await pollStatus();

    expect(getState().run).toEqual(activeRun);
  });

  it("dismissFinished records the dismissed run's finishedAt", async () => {
    stubFetch([{ body: { run: finishedRun } }]);
    await pollStatus();

    dismissFinished();

    expect(getState().dismissedFinishedAt).toBe(finishedRun.finishedAt);
  });

  it("startRefresh POSTs and then polls the status endpoint", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ runId: "r1", boardCount: 2 }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ run: activeRun }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await startRefresh();

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/refresh", expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/refresh/status", expect.anything());
    expect(getState().run).toEqual(activeRun);
  });

  it("startRefresh still polls when the run was refused as already running", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: "already_running", run: activeRun }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ run: activeRun }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(startRefresh()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getState().run).toEqual(activeRun);
  });
});
