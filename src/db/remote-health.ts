/**
 * Circuit breaker for the remote (Neon) database.
 *
 * After a connection/limit failure the remote is considered down for a
 * backoff window (15s doubling to 5min). While down, reads/writes are served
 * by the on-device store and writes land in the sync queue; when the window
 * elapses the next database call probes the remote inline and recovers if it
 * answers. A backoff that only ever grows would leave a healthy-again remote
 * unsynced for too long — recovery is attempted on every elapsed window.
 */

export type RemoteState = "up" | "down";

const BASE_BACKOFF_MS = 15_000;
const MAX_BACKOFF_MS = 5 * 60_000;

export class CircuitBreaker {
  private state: RemoteState = "up";
  private failures = 0;
  private openUntil = 0;
  private lastError: string | null = null;
  private lastErrorAt: string | null = null;
  private lastErrorClass: "connection" | "limit" | null = null;
  private lastSuccessAt: string | null = null;

  constructor(private now: () => number = () => Date.now()) {}

  /** True when remote calls should be attempted (never down, or window elapsed). */
  canAttempt(): boolean {
    return this.state === "up" || this.now() >= this.openUntil;
  }

  get isOpen(): boolean {
    return this.state === "down" && this.now() < this.openUntil;
  }

  recordSuccess(): void {
    this.state = "up";
    this.failures = 0;
    this.openUntil = 0;
    this.lastError = null;
    this.lastErrorClass = null;
    this.lastSuccessAt = new Date(this.now()).toISOString();
  }

  /** True when this failure transitioned the breaker from up → down. */
  recordFailure(err: unknown, errorClass: "connection" | "limit"): boolean {
    this.failures += 1;
    this.state = "down";
    this.lastErrorClass = errorClass;
    this.lastError = err instanceof Error ? err.message : String(err);
    this.lastErrorAt = new Date(this.now()).toISOString();
    const wasOpen = this.now() < this.openUntil;
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (this.failures - 1), MAX_BACKOFF_MS);
    this.openUntil = this.now() + backoff;
    return !wasOpen;
  }

  secondsUntilRetry(): number {
    if (this.state !== "down") return 0;
    return Math.max(0, Math.ceil((this.openUntil - this.now()) / 1000));
  }

  status() {
    return {
      state: this.state,
      failures: this.failures,
      retryInSec: this.secondsUntilRetry(),
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      lastErrorClass: this.lastErrorClass,
      lastSuccessAt: this.lastSuccessAt,
    };
  }
}

declare const globalThis: { __jobradarBreaker?: CircuitBreaker };

/** Process-wide breaker (HMR-safe). */
export function getBreaker(): CircuitBreaker {
  globalThis.__jobradarBreaker ??= new CircuitBreaker();
  return globalThis.__jobradarBreaker;
}

export function resetBreakerForTests(): void {
  globalThis.__jobradarBreaker = undefined;
}
