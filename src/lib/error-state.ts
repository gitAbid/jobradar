import { classifyRemoteError } from "@/db/errors";

/**
 * Decide whether an error caught by an error boundary is a DB outage.
 *
 * In production, server errors reach the client with a generic message and only
 * a `digest`, so the message can't be classified there — the boundary confirms
 * via /api/health instead. In dev (and for client-thrown errors) the original
 * message survives and `classifyRemoteError` can decide directly.
 */
export function isDbUnavailableError(error: { message?: string; digest?: string }): boolean {
  const message = error.message ?? "";
  // Next's redacted server-render message: nothing to classify.
  if (error.digest && /server components render/i.test(message)) return false;
  return classifyRemoteError(error) !== "query";
}

/** True when the health payload reports the database as down. */
export function healthSaysDbDown(status: number, body: unknown): boolean {
  if (status === 503) return true;
  return typeof body === "object" && body !== null && (body as { db?: unknown }).db === "down";
}
