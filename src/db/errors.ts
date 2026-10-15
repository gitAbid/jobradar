/**
 * Remote (Neon) error handling: timeouts and failure classification.
 */

export type RemoteErrorClass = "connection" | "limit" | "query";

/**
 * Bucket a remote (Neon) failure:
 *  - connection: unreachable / dropped / timed out — retry with backoff
 *  - limit: quota, connection cap, compute suspended — same treatment, but
 *    reported distinctly in the status endpoint
 *  - query: a real SQL/constraint bug — must surface, never mask
 */
export function classifyRemoteError(err: unknown): RemoteErrorClass {
  if (err instanceof RemoteTimeoutError) return "connection";

  const e = err as { code?: string; errno?: string; message?: string; cause?: unknown };
  const code = String(e?.code ?? "");
  const lowerCode = code.toLowerCase();
  // Node.js and driver error codes are uppercase (ECONNREFUSED, ETIMEDOUT);
  // Postgres codes are lowercase (53000, 08006). Lowercase for regex matching.
  const parts: string[] = [String(e?.message ?? err)];
  if (e?.errno) parts.push(String(e.errno));
  let cause: unknown = e?.cause;
  for (let depth = 0; depth < 3 && cause; depth += 1) {
    const c = cause as { message?: string; code?: string; errno?: string; cause?: unknown };
    if (c.message) parts.push(String(c.message));
    if (c.code) parts.push(String(c.code));
    if (c.errno) parts.push(String(c.errno));
    cause = c.cause;
  }
  const blob = parts.join(" ").toLowerCase();

  if (
    /^(econn|etimedout|enotfound|eai_again|epipe|eperm|eacces|connect_timeout|timeout|connection_|ecanceled)/.test(
      lowerCode,
    ) ||
    /connect/i.test(code) ||
    /connection refused|connection terminated|connection closed|connection ended|connection destroyed|connection error|connection timed out|connect timeout|connect_timeout|socket|network|dns|econnrefused|econnreset|etimedout|enotfound|eai_again|epipe|fetch failed|ssl|tls|handshake|self signed|57p|08p|^08|53300|08006|could not connect/.test(
      blob,
    )
  ) {
    return "connection";
  }

  if (
    /too many connections|too many clients|connection limit|max_connections|rate limit|rate-limit|quota|exceeded|suspending|suspended|compute|insufficient|credits|out of resources|429/.test(
      blob,
    )
  ) {
    return "limit";
  }

  return "query";
}

/** Thrown when a remote call exceeds its time budget — treated as unreachable. */
export class RemoteTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "RemoteTimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RemoteTimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
