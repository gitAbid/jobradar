import { Cron } from "croner";
import { getRefreshIntervalHours } from "@/lib/settings";
import { refreshAll } from "@/lib/refresh";

declare const globalThis: { __jobradarCron?: Cron };

/**
 * Start the background refresher. Safe to call multiple times —
 * only the first call schedules a job (guards against HMR duplicates).
 */
export function startScheduler(): void {
  if (globalThis.__jobradarCron) return;

  const hours = Math.max(1, Math.floor(getRefreshIntervalHours()));
  globalThis.__jobradarCron = new Cron(`0 */${hours} * * *`, { name: "jobradar-refresh" }, () => {
    void refreshAll().catch(() => {
      /* per-board errors already recorded; keep cron alive */
    });
  });

  console.log(`[jobradar] auto-refresh scheduled every ${hours}h`);
}
