"use client";

import { useSyncExternalStore } from "react";
import type { RefreshRun } from "@/lib/refresh-run";

const ACTIVE_POLL_MS = 1_500;
const IDLE_POLL_MS = 15_000;

export interface RefreshClientState {
  /** last known server-side run (active or finished) */
  run: RefreshRun | null;
  /** id of a run whose active→finished transition was observed live */
  completedRunId: string | null;
  /** finishedAt of the run the user (or auto-hide) dismissed */
  dismissedFinishedAt: string | null;
}

declare const globalThis: { __jobradarRefreshClient?: RefreshClientState };

const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollInFlight = false;

export function getState(): RefreshClientState {
  if (!globalThis.__jobradarRefreshClient) {
    globalThis.__jobradarRefreshClient = {
      run: null,
      completedRunId: null,
      dismissedFinishedAt: null,
    };
  }
  return globalThis.__jobradarRefreshClient;
}

/** Stable empty snapshot for SSR/hydration — the bar renders nothing then. */
const SERVER_SNAPSHOT: RefreshClientState = {
  run: null,
  completedRunId: null,
  dismissedFinishedAt: null,
};

export function getServerSnapshot(): RefreshClientState {
  return SERVER_SNAPSHOT;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRefreshStatus(): RefreshClientState {
  return useSyncExternalStore(subscribe, getState, getServerSnapshot);
}

export function isRunActive(state: RefreshClientState): boolean {
  return state.run !== null && state.run.finishedAt === null;
}

function setState(next: RefreshClientState): void {
  globalThis.__jobradarRefreshClient = next;
  for (const listener of listeners) listener();
}

/** Fetch the run snapshot; tolerates failures (e.g. dev server restarting). */
export async function pollStatus(): Promise<void> {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const res = await fetch("/api/refresh/status", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { run: RefreshRun | null };
    const prev = getState();
    const run = data.run;
    if (JSON.stringify(prev.run) === JSON.stringify(run)) return;
    const completed =
      prev.run !== null && prev.run.finishedAt === null && run?.finishedAt != null
        ? run.id
        : prev.completedRunId;
    setState({ run, completedRunId: completed ?? null, dismissedFinishedAt: prev.dismissedFinishedAt });
  } catch {
    // unreachable — keep last known state
  } finally {
    pollInFlight = false;
  }
}

export function dismissFinished(): void {
  const prev = getState();
  if (!prev.run?.finishedAt) return;
  setState({ ...prev, dismissedFinishedAt: prev.run.finishedAt });
}

/**
 * Fire a refresh and immediately pick up its run. Tolerates a 409 (a run is
 * already in flight — polling will show it).
 */
export async function startRefresh(): Promise<void> {
  try {
    await fetch("/api/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch {
    // the status poll below reflects reality
  }
  await pollStatus();
  ensurePolling();
}

/**
 * Poll in the background for the app's lifetime: fast while a run is active,
 * slow while idle so scheduled (cron) refreshes get picked up too.
 * Idempotent — safe to call from any mounted component.
 */
export function ensurePolling(): void {
  if (pollTimer !== null) return;
  const tick = async () => {
    await pollStatus();
    pollTimer = setTimeout(() => void tick(), isRunActive(getState()) ? ACTIVE_POLL_MS : IDLE_POLL_MS);
  };
  pollTimer = setTimeout(() => void tick(), 0);
}
