export async function register() {
  // Only run in the Node.js server runtime, never during `next build`.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { backfillSkillsIfNeeded } = await import("./lib/skills-backfill");
    backfillSkillsIfNeeded();
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
