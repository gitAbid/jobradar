// Per-process Neon usage counters: a sliding hour made of 60 one-minute
// buckets. Approximate by design (per serverless instance, not global).

const MINUTE_MS = 60_000;
const BUCKETS = 60;

interface Bucket {
  minute: number; // floor(ms / 60_000) this bucket currently represents
  queries: number;
  bytes: number;
}

declare const globalThis: {
  __jobradarUsage?: { buckets: Bucket[]; lastLogged: number };
};

function state() {
  if (!globalThis.__jobradarUsage) {
    globalThis.__jobradarUsage = {
      buckets: Array.from({ length: BUCKETS }, () => ({ minute: -1, queries: 0, bytes: 0 })),
      lastLogged: 0,
    };
  }
  return globalThis.__jobradarUsage;
}

/** Record one remote call. `bytes` is the approximate response size (0 if none). */
export function recordQuery(bytes = 0, now: number = Date.now()): void {
  const s = state();
  const minute = Math.floor(now / MINUTE_MS);
  const b = s.buckets[minute % BUCKETS];
  if (b.minute !== minute) {
    b.minute = minute;
    b.queries = 0;
    b.bytes = 0;
  }
  b.queries += 1;
  b.bytes += bytes;

  // Lazy hourly log (no timers in serverless).
  if (s.lastLogged === 0) {
    s.lastLogged = now;
  } else if (now - s.lastLogged >= BUCKETS * MINUTE_MS) {
    s.lastLogged = now;
    const u = usageLastHour(now);
    console.log(
      `[jobradar] neon usage last hour: ${u.queriesLastHour} queries, ~${Math.round(u.approxBytesLastHour / 1024)} KB`,
    );
  }
}

export function usageLastHour(now: number = Date.now()): {
  queriesLastHour: number;
  approxBytesLastHour: number;
} {
  const current = Math.floor(now / MINUTE_MS);
  let queries = 0;
  let bytes = 0;
  for (const b of state().buckets) {
    if (b.minute > current - BUCKETS && b.minute <= current) {
      queries += b.queries;
      bytes += b.bytes;
    }
  }
  return { queriesLastHour: queries, approxBytesLastHour: bytes };
}

/** Test helper. */
export function resetUsage(): void {
  globalThis.__jobradarUsage = undefined;
}

export function approxBytes(rows: unknown): number {
  try {
    return JSON.stringify(rows).length;
  } catch {
    return 0;
  }
}
