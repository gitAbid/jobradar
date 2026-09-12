"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, X } from "lucide-react";
import { beep } from "@/lib/beep";
import {
  dismissFinished,
  ensurePolling,
  isRunActive,
  useRefreshStatus,
} from "@/lib/refresh-client";

/** How long the finished summary stays before auto-hiding. */
const SUMMARY_VISIBLE_MS = 6000;
/** Don't resurface a summary for a run that finished long before mount. */
const SUMMARY_FRESH_MS = 60_000;

/**
 * Slim refresh progress bar mounted in the sticky header on every page.
 * State lives server-side (run tracker) and is polled by the client store,
 * so it survives navigation and reloads and also covers scheduled refreshes.
 */
export function RefreshStatusBar({ soundEnabled }: { soundEnabled: boolean }) {
  const state = useRefreshStatus();
  const router = useRouter();

  useEffect(() => {
    ensurePolling();
  }, []);

  const run = state.run;
  const active = isRunActive(state);
  const done = run ? run.boards.filter((b) => b.status === "ok" || b.status === "error").length : 0;
  const total = run?.boards.length ?? 0;
  const failed = run ? run.boards.filter((b) => b.status === "error").length : 0;
  const inserted = run?.totalInserted ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // completion: chirp + refresh the current page's server data (once per run)
  const handledCompletion = useRef<string | null>(null);
  useEffect(() => {
    if (!state.completedRunId || handledCompletion.current === state.completedRunId) return;
    handledCompletion.current = state.completedRunId;
    if (soundEnabled && inserted > 0) beep();
    router.refresh();
  }, [state.completedRunId, soundEnabled, inserted, router]);

  const summaryFresh =
    run?.finishedAt != null && Date.now() - new Date(run.finishedAt).getTime() < SUMMARY_FRESH_MS;
  const showSummary = !active && run?.finishedAt != null && summaryFresh && run.finishedAt !== state.dismissedFinishedAt;

  useEffect(() => {
    if (!showSummary) return;
    const timer = setTimeout(dismissFinished, SUMMARY_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [showSummary]);

  if (!active && !showSummary) return null;

  const label = run?.trigger === "scheduled" ? "Auto-refresh" : "Refreshing jobs";

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-t border-teal-100 bg-teal-50/95 text-teal-950"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-1.5 sm:px-6">
        {active ? (
          <>
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-teal-600" />
            <span className="shrink-0 text-sm font-semibold text-teal-900">
              {label}&hellip;
            </span>
            <span className="hidden shrink-0 text-xs font-medium text-teal-700 sm:inline">
              {done}/{total} boards{inserted > 0 && ` · +${inserted} new`}
            </span>
            <div
              className="h-1 min-w-16 flex-1 overflow-hidden rounded-full bg-teal-100"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              aria-label="Refresh progress"
            >
              <div
                className="h-full rounded-full bg-teal-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            {failed > 0 && (
              <span className="shrink-0 text-xs font-semibold text-rose-600">
                {failed} failed
              </span>
            )}
          </>
        ) : (
          <>
            <span className="flex-1 text-sm font-medium text-teal-900">
              {run!.trigger === "scheduled" ? "Auto-refresh" : "Refresh"} complete
              {inserted > 0 && <span className="font-semibold"> · +{inserted} new</span>}
              {failed > 0 && <span className="font-semibold text-rose-600"> · {failed} failed</span>}
              {inserted === 0 && failed === 0 && " · up to date"}
            </span>
            <button
              type="button"
              onClick={dismissFinished}
              aria-label="Dismiss"
              className="inline-flex min-h-8 shrink-0 items-center p-1 text-teal-500 transition-colors hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
