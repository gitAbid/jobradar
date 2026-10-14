import { classifyRemoteError } from "@/db/errors";
import { authenticateApiKey, type KeyStore } from "@/lib/api/keys";
import { parseJobsQuery } from "@/lib/api/query";
import { toPublicJob } from "@/lib/api/serialize";
import { loadJobView, type JobView, type RawParams } from "@/lib/job-view";
import { getCachedListingById } from "@/lib/job-query";
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

async function requireAuth(request: Request, store: KeyStore): Promise<Response | null> {
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
    return apiError(503, "unavailable");
  }
  if (auth.ok) return null;
  return apiError(auth.status, auth.status === 403 ? "revoked" : "unauthorized");
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

export const sqlFeedSource: FeedSource = {
  view: (params, opts) => loadJobView(params, [], { pageSize: opts.pageSize }),
  byId: (id) => getCachedListingById(id),
};

export type FeedResult =
  | { ok: true; feed: FeedSource }
  | { ok: false; error: Response };

/** Lazily resolves the feed; only invoked after the request authenticated. */
export type FeedLoader = () => Promise<FeedResult>;

/**
 * Route-level feed loader. Errors from the DB surface per call (see
 * `guardFeed`), so this only hands out the SQL-backed source.
 */
export async function loadFeedSafe(): Promise<FeedResult> {
  return { ok: true, feed: guardFeed(sqlFeedSource) };
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
  const denied = await requireAuth(request, store);
  if (denied) return denied;

  const parsed = parseJobsQuery(request.url);
  if (!parsed.ok) return apiError(400, "invalid_params", parsed.error);

  const loaded = await loadFeed();
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
  const denied = await requireAuth(request, store);
  if (denied) return denied;

  const loaded = await loadFeed();
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
  const denied = await requireAuth(request, store);
  if (denied) return denied;

  const loaded = await loadFeed();
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
