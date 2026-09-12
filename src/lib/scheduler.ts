import { Cron } from "croner";
import { getRefreshIntervalHours } from "@/lib/settings";
import { refreshAll } from "@/lib/refresh";

declare const globalThis: { __jobradarCron?: Cron };

/**
 * Start the background refresher for long-lived processes (local dev / a
 * container host). Safe to call multiple times — only the first call
 * schedules a job (guards against HMR duplicates).
 *
 * On Vercel this is a no-op: serverless invocations are too short-lived for
 * an in-process cron, so a daily Vercel Cron hits /api/refresh/cron instead.
 */
export async function startScheduler(): Promise<void> {
  if (process.env.VERCEL) return;

  if (globalThis.__jobradarCron) return;

  const hours = Math.max(1, Math.floor(await getRefreshIntervalHours()));
  globalThis.__jobradarCron = new Cron(`0 */${hours} * * *`, { name: "jobradar-refresh" }, () => {
    // null = a manual refresh is still in flight; skip this tick
    void refreshAll(undefined, "scheduled").catch(() => {
      /* per-board errors already recorded; keep cron alive */
    });
  });

  console.log(`[jobradar] auto-refresh scheduled every ${hours}h`);
}
