import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
const probe = vi.fn();
vi.mock("@/db/remote", () => ({ probeRemote: () => probe() }));

import { recordQuery, resetUsage, usageLastHour } from "@/db/usage";
import { GET } from "@/app/api/health/route";

const MIN = 60_000;

describe("usage window", () => {
  beforeEach(() => resetUsage());

  it("sums within the hour and expires old buckets", () => {
    const t0 = 1_000_000 * MIN;
    recordQuery(100, t0);
    recordQuery(50, t0 + 5 * MIN);
    expect(usageLastHour(t0 + 10 * MIN)).toEqual({ queriesLastHour: 2, approxBytesLastHour: 150 });
    expect(usageLastHour(t0 + 60 * MIN)).toEqual({ queriesLastHour: 1, approxBytesLastHour: 50 });
    expect(usageLastHour(t0 + 65 * MIN)).toEqual({ queriesLastHour: 0, approxBytesLastHour: 0 });
  });

  it("reuses a bucket slot after an hour", () => {
    const t0 = 1_000_000 * MIN;
    recordQuery(10, t0);
    recordQuery(20, t0 + 60 * MIN);
    expect(usageLastHour(t0 + 60 * MIN)).toEqual({ queriesLastHour: 1, approxBytesLastHour: 20 });
  });

  it("logs at most once per hour", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const t0 = 1_000_000 * MIN;
    recordQuery(1, t0);
    recordQuery(1, t0 + 30 * MIN);
    expect(log).not.toHaveBeenCalled();
    recordQuery(1, t0 + 61 * MIN);
    recordQuery(1, t0 + 62 * MIN);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});

describe("GET /api/health", () => {
  beforeEach(() => {
    resetUsage();
    probe.mockReset();
  });

  it("200 when up", async () => {
    probe.mockResolvedValue(true);
    recordQuery(2048);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ db: "up", queriesLastHour: 1, approxBytesLastHour: 2048 });
  });

  it("503 with no error string when down", async () => {
    probe.mockRejectedValue(new Error("secret host"));
    // step past the previous test's cached probe
    vi.useFakeTimers({ now: Date.now() + 60_000 });
    const res = await GET();
    vi.useRealTimers();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.db).toBe("down");
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("reuses a probe from the last 30 s", async () => {
    vi.useFakeTimers({ now: Date.now() + 120_000 });
    probe.mockResolvedValue(true);
    await GET();
    await GET();
    vi.useRealTimers();
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
