import { timingSafeEqual } from "node:crypto";

let warnedMissingSecret = false;

/**
 * Fail-closed gate for cron endpoints: requires CRON_SECRET to be set and the
 * request to carry "Authorization: Bearer <secret>". Constant-time compare.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.error("CRON_SECRET is not set; rejecting all cron requests");
    }
    return false;
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Test-only: reset the log-once flag. */
export function _resetCronAuthWarning(): void {
  warnedMissingSecret = false;
}
