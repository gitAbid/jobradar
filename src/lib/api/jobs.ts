import { classifyRemoteError } from "@/db/errors";
import { authenticateApiKey, hashKey, presentedApiKey, type KeyStore } from "@/lib/api/keys";
import { parseJobsQuery } from "@/lib/api/query";
import { toPublicJob } from "@/lib/api/serialize";
import { loadJobView, type JobView, type RawParams } from "@/lib/job-view";
import { fetchListingById, fetchUserListingState } from "@/lib/job-query";
import { remoteQuery } from "@/db/remote";
import type { FilterableListing } from "@/lib/types";

// ── Shared response plumbing ────────────────────────────────────────────────

const API_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, x-api-key",
  "Cache-Control": "no-store",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: API_HEADERS });
}

export function apiError(status: number, code: string, details?: unknown): Response {
  return jsonResponse(details === undefined ? { error: code } : { error: code, details }, status);
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: API_HEADERS });
}

const DEFAULT_RATE_LIMIT_PER_HOUR = 600;

function rateLimit(): number {
  const n = Number.parseInt(process.env.API_RATE_LIMIT_PER_HOUR ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RATE_LIMIT_PER_HOUR;
}

const DEFAULT_AUTH_FAIL_LIMIT_PER_HOUR = 30;

function authFailLimit(): number {
  const n = Number.parseInt(process.env.API_AUTH_FAIL_LIMIT_PER_HOUR ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_AUTH_FAIL_LIMIT_PER_HOUR;
}

function rateLimited(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { ...API_HEADERS, "Retry-After": String(retryAfterSeconds) } },
  );
}

/**
 * Opaque per-client id for the failed-key limiter: sha256 of the client IP.
 * Vercel sets both headers itself (client-supplied values are overwritten).
 */
export function clientId(request: Request): string {
  const ip =
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  return hashKey(`ip:${ip}`);
}

/**
 * Clients over the failed-key limit, per store: client id → blocked-until
 * (epoch ms). Once an instance has seen a client go over, it turns that
 * client away without any database work until the window ends; other
 * instances learn it from the shared counter on their next failure.
 */
const blockedClients = new WeakMap<KeyStore, Map<string, number>>();
const MAX_BLOCKED_CLIENTS = 10_000;

function blockedFor(store: KeyStore, client: string, now: number): number | null {
  const until = blockedClients.get(store)?.get(client);
  if (until === undefined) return null;
  if (until > now) return Math.max(1, Math.ceil((until - now) / 1000));
  blockedClients.get(store)?.delete(client);
  return null;
}

function block(store: KeyStore, client: string, until: number): void {
  const perStore = blockedClients.get(store) ?? new Map<string, number>();
  if (perStore.size >= MAX_BLOCKED_CLIENTS) {
    const now = Date.now();
    for (const [c, u] of perStore) if (u <= now) perStore.delete(c);
    if (perStore.size >= MAX_BLOCKED_CLIENTS) perStore.clear(); // the DB counter still holds
  }
  perStore.set(client, until);
  blockedClients.set(store, perStore);
}

/**
 * Counts a failed key check for the client; resolves the 429 once it is over
 * the limit. Errors are logged and swallowed — the request is rejected anyway.
 */
async function throttleFailure(store: KeyStore, client: string): Promise<Response | null> {
  try {
    const { count, retryAfterSeconds } = await store.hitAuthFailure(client);
    if (count <= authFailLimit()) return null;
    block(store, client, Date.now() + retryAfterSeconds * 1000);
    return rateLimited(retryAfterSeconds);
  } catch (err) {
    console.error(
      "[jobradar] v1 api: failed-key limiter unavailable:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Throttles clients with too many failed keys, then authenticates, then
 * rate-limits the key; resolves the owner's id or the error response.
 */
async function requireAuth(
  request: Request,
  store: KeyStore,
): Promise<{ userId: string } | { denied: Response }> {
  const client = clientId(request);
  const blocked = blockedFor(store, client, Date.now());
  if (blocked !== null) return { denied: rateLimited(blocked) };

  let auth;
  try {
    auth = await authenticateApiKey(request, store);
  } catch (err) {
    // Fail closed: a key we can't verify is never accepted. Real SQL bugs
    // still throw; only an unreachable/quota-blocked DB becomes a 503.
    if (classifyRemoteError(err) === "query") throw err;
    console.error(
      "[jobradar] v1 api: key verification unavailable:",
      err instanceof Error ? err.message : err,
    );
    return { denied: apiError(503, "unavailable") };
  }
  if (auth.ok) {
    try {
      const { count, retryAfterSeconds } = await store.hitRate(auth.key.id);
      if (count > rateLimit()) return { denied: rateLimited(retryAfterSeconds) };
    } catch (err) {
      // Fail closed on any rate-store error.
      console.error(
        "[jobradar] v1 api: rate limit unavailable:",
        err instanceof Error ? err.message : err,
      );
      return { denied: apiError(503, "unavailable") };
    }
    return { userId: auth.userId };
  }
  // A key was looked up and rejected: count it. A missing key cost no lookup.
  if (presentedApiKey(request)) {
    const throttled = await throttleFailure(store, client);
    if (throttled) return { denied: throttled };
  }
  return { denied: apiError(auth.status, auth.status === 403 ? "revoked" : "unauthorized") };
}

/**
 * What the v1 endpoints read: one page + facets for a filter set, or one
 * listing by id. SQL-backed in production (no full-table reads); tests can
 * inject an in-memory implementation.
 */
export interface FeedSource {
  view(params: RawParams, opts: { pageSize?: number }): Promise<JobView>;
  byId(id: number): Promise<FilterableListing | null>;
}

/** Feed bound to one user: their hidden/status/tags apply. */
export function sqlFeedSource(userId: string): FeedSource {
  return {
    view: (params, opts) => loadJobView(userId, params, [], { pageSize: opts.pageSize }),
    byId: async (id) => {
      const listing = await fetchListingById(remoteQuery, id);
      if (!listing) return null;
      return { ...listing, ...(await fetchUserListingState(remoteQuery, userId, id)) };
    },
  };
}

export type FeedResult =
  | { ok: true; feed: FeedSource }
  | { ok: false; error: Response };

/** Lazily resolves the feed for the key's owner; only invoked after auth + rate limit. */
export type FeedLoader = (userId: string) => Promise<FeedResult>;

/**
 * Route-level feed loader. Errors from the DB surface per call (see
 * `guardFeed`), so this only hands out the SQL-backed source.
 */
export async function loadFeedSafe(userId: string): Promise<FeedResult> {
  return { ok: true, feed: guardFeed(sqlFeedSource(userId)) };
}

/**
 * Wraps a feed so a dead/quota-blocked database becomes an actionable 503
 * JSON instead of an empty 500. Real SQL bugs still throw (they must
 * surface, never masquerade as downtime).
 */
export class FeedUnavailableError extends Error {}

function guardFeed(feed: FeedSource): FeedSource {
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (classifyRemoteError(err) === "query") throw err;
      console.error(
        "[jobradar] v1 api: listings unavailable:",
        err instanceof Error ? err.message : err,
      );
      throw new FeedUnavailableError("database unreachable");
    }
  };
  return {
    view: (params, opts) => guard(() => feed.view(params, opts)),
    byId: (id) => guard(() => feed.byId(id)),
  };
}

function unavailable(): Response {
  return apiError(503, "unavailable", "database unreachable");
}

// ── GET /api/v1/jobs ────────────────────────────────────────────────────────

export async function jobsListResponse(
  request: Request,
  store: KeyStore,
  loadFeed: FeedLoader,
): Promise<Response> {
  const authed = await requireAuth(request, store);
  if ("denied" in authed) return authed.denied;

  const parsed = parseJobsQuery(request.url);
  if (!parsed.ok) return apiError(400, "invalid_params", parsed.error);

  const loaded = await loadFeed(authed.userId);
  if (!loaded.ok) return loaded.error;
  let view: JobView;
  try {
    view = await loaded.feed.view(parsed.params, { pageSize: parsed.pageSize });
  } catch (err) {
    if (err instanceof FeedUnavailableError) return unavailable();
    throw err;
  }

  return jsonResponse({
    data: view.entries.map((e) => toPublicJob(e.listing)),
    pagination: {
      page: view.currentPage,
      pageSize: parsed.pageSize,
      total: view.totalVisible,
      totalPages: view.totalPages,
    },
    generatedAt: new Date().toISOString(),
  });
}

// ── GET /api/v1/jobs/:id ────────────────────────────────────────────────────

export async function jobDetailResponse(
  request: Request,
  store: KeyStore,
  idParam: string,
  loadFeed: FeedLoader,
): Promise<Response> {
  const authed = await requireAuth(request, store);
  if ("denied" in authed) return authed.denied;

  const loaded = await loadFeed(authed.userId);
  if (!loaded.ok) return loaded.error;
  const id = Number.parseInt(idParam, 10);
  // postgres int4 range; anything else cannot exist
  if (Number.isNaN(id) || id < 1 || id > 2_147_483_647) return apiError(404, "not_found");
  let listing: FilterableListing | null;
  try {
    listing = await loaded.feed.byId(id);
  } catch (err) {
    if (err instanceof FeedUnavailableError) return unavailable();
    throw err;
  }
  if (!listing || listing.status === "hidden") return apiError(404, "not_found");

  return jsonResponse({
    data: toPublicJob(listing),
    generatedAt: new Date().toISOString(),
  });
}

// ── GET /api/v1/meta ────────────────────────────────────────────────────────

export async function metaResponse(
  request: Request,
  store: KeyStore,
  loadFeed: FeedLoader,
): Promise<Response> {
  const authed = await requireAuth(request, store);
  if ("denied" in authed) return authed.denied;

  const loaded = await loadFeed(authed.userId);
  if (!loaded.ok) return loaded.error;
  // No selections → facet counts over the whole non-hidden pool.
  let view: JobView;
  try {
    view = await loaded.feed.view({}, { pageSize: 1 });
  } catch (err) {
    if (err instanceof FeedUnavailableError) return unavailable();
    throw err;
  }
  const byParam = Object.fromEntries(
    view.facets.map((f) => [f.param as string, f.values]),
  );

  return jsonResponse({
    total: view.totalVisible,
    skills: byParam.skill,
    countries: byParam.country,
    companies: byParam.company,
    sources: byParam.source,
    generatedAt: new Date().toISOString(),
  });
}
