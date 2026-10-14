import { apiKeys } from "@/lib/api/keys-store";
import { corsPreflight, jobsListResponse, loadListingsPoolSafe } from "@/lib/api/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const pool = await loadListingsPoolSafe();
  if (!pool.ok) return pool.error;
  return jobsListResponse(request, apiKeys(), pool.pool);
}

export { corsPreflight as OPTIONS };
