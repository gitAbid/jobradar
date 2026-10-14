import { attachDescriptions, LISTING_POOL_SELECT, q, rowToListing } from "@/db";
import { classifyRemoteError } from "@/db/translate";
import { authenticateApiKey, type KeyStore } from "@/lib/api/keys";
import { parseJobsQuery } from "@/lib/api/query";
import { toPublicJob } from "@/lib/api/serialize";
import { buildJobView } from "@/lib/job-view";
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

/** The listings pool joined with board names — pruned columns (see LISTING_POOL_SELECT). */
export async function loadListingsPool(): Promise<FilterableListing[]> {
  const rows = await q<Record<string, unknown>>(
    `select ${LISTING_POOL_SELECT}, b.name as board_name, b.filter_keywords as board_filter_keywords
     from listings l join boards b on b.id = l.board_id
     order by coalesce(l.posted_at, l.fetched_at) desc`,
  );
  return rows.map((r) => rowToListing(r as never)) as FilterableListing[];
}

export type ListingsPoolResult =
  | { ok: true; pool: FilterableListing[] }
  | { ok: false; error: Response };

/** Lazily loads the pool; only invoked after the request authenticated. */
export type PoolLoader = () => Promise<ListingsPoolResult>;

/**
 * Route-level pool loader: a dead/quota-blocked database becomes an
 * actionable 503 JSON instead of an empty 500. Real SQL bugs still throw
 * (they must surface, never masquerade as downtime).
 */
export async function loadListingsPoolSafe(): Promise<ListingsPoolResult> {
  try {
    return { ok: true, pool: await loadListingsPool() };
  } catch (err) {
    if (classifyRemoteError(err) === "query") throw err;
    console.error(
      "[jobradar] v1 api: listings pool unavailable:",
      err instanceof Error ? err.message : err,
    );
    return { ok: false, error: apiError(503, "unavailable", "database unreachable") };
  }
}

// ── GET /api/v1/jobs ────────────────────────────────────────────────────────

export async function jobsListResponse(
  request: Request,
  store: KeyStore,
  loadPool: PoolLoader,
): Promise<Response> {
  const denied = await requireAuth(request, store);
  if (denied) return denied;

  const parsed = parseJobsQuery(request.url);
  if (!parsed.ok) return apiError(400, "invalid_params", parsed.error);

  const loaded = await loadPool();
  if (!loaded.ok) return loaded.error;
  const view = buildJobView(loaded.pool, parsed.params, [], { pageSize: parsed.pageSize });
  await attachDescriptions(view.entries);

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
  loadPool: PoolLoader,
): Promise<Response> {
  const denied = await requireAuth(request, store);
  if (denied) return denied;

  const loaded = await loadPool();
  if (!loaded.ok) return loaded.error;
  const id = Number.parseInt(idParam, 10);
  const listing = Number.isNaN(id) ? undefined : loaded.pool.find((l) => l.id === id);
  if (!listing || listing.status === "hidden") return apiError(404, "not_found");
  await attachDescriptions([{ listing }]);

  return jsonResponse({
    data: toPublicJob(listing),
    generatedAt: new Date().toISOString(),
  });
}

// ── GET /api/v1/meta ────────────────────────────────────────────────────────

export async function metaResponse(
  request: Request,
  store: KeyStore,
  loadPool: PoolLoader,
): Promise<Response> {
  const denied = await requireAuth(request, store);
  if (denied) return denied;

  const loaded = await loadPool();
  if (!loaded.ok) return loaded.error;
  // No selections → facet counts over the whole non-hidden pool.
  const view = buildJobView(loaded.pool, {}, []);
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
