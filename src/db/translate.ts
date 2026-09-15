/**
 * Postgres → SQLite translation for the local-first layer.
 *
 * The whole app writes Postgres-dialect SQL with `$n` placeholders (Neon).
 * The on-device SQLite mirror executes the same statements, so every query
 * passes through here first. The app's SQL surface is small and reviewed in
 * one place (this repo), which keeps the translation honest: `$n` params and
 * `::type` casts are the only PG-isms in the query set. Statements that are
 * Postgres-only (RLS, DDL, the unnest-based seed) are flagged `skipLocal` —
 * the local schema owns its own DDL and seeds itself.
 */

export interface Translated {
  sql: string;
  /** Params expanded to one value per `?` (repeated `$n` duplicates the value). */
  params: unknown[];
  /** True when the statement must not run against SQLite (PG-only DDL/RLS/seed). */
  skipLocal: boolean;
}

export function translateToSqlite(query: string, params: unknown[] = []): Translated {
  const skipLocal = isPostgresOnly(query);
  const byIndex = new Map<number, unknown>();
  params.forEach((p, i) => byIndex.set(i + 1, p === undefined ? null : p));

  // strip `::type` casts before placeholder expansion (no string literal in
  // this repo's SQL ever contains "::")
  const stripped = query.replace(/::\s*[a-zA-Z_][a-zA-Z0-9_]*(\s*\(\s*\d+\s*\))?/g, "");

  const expanded: unknown[] = [];
  const sql = stripped.replace(/\$(\d+)/g, (_, n: string) => {
    expanded.push(byIndex.get(Number(n)) ?? null);
    return "?";
  });

  return { sql, params: expanded, skipLocal };
}

/** Statements that exist only to shape/seed the remote Postgres database. */
export function isPostgresOnly(query: string): boolean {
  const sql = query.trim();
  if (/^(create|alter|drop)\b/i.test(sql)) return true;
  if (/\bunnest\s*\(/i.test(sql)) return true;
  return false;
}

/** Reads are served from the local mirror/cache; everything else is a write. */
export function isReadStatement(query: string): boolean {
  return /^\s*(select|with)\b/i.test(query);
}

/** INSERT/UPDATE/DELETE with a RETURNING clause — resolves to rows, not a count. */
export function hasReturningClause(query: string): boolean {
  return /\breturning\b/i.test(query);
}

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
