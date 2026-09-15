export async function register() {
  // Only run in the Node.js server runtime, never during `next build`.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    // Open the on-device store and start the sync loop before anything else
    // so the first request already reads from the local mirror (and keeps
    // working when Neon is unreachable or over limits).
    const { initBackgroundSync } = await import("@/db/sync");
    initBackgroundSync();

    const { backfillSkillsIfNeeded } = await import("./lib/skills-backfill");
    void backfillSkillsIfNeeded().catch((err) => {
      console.error("[jobradar] skills backfill failed:", err);
    });
    const { startScheduler } = await import("./lib/scheduler");
    await startScheduler();
  }
}
