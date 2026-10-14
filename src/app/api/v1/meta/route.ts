import { apiKeys } from "@/lib/api/keys-store";
import { corsPreflight, loadListingsPoolSafe, metaResponse } from "@/lib/api/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const pool = await loadListingsPoolSafe();
  if (!pool.ok) return pool.error;
  return metaResponse(request, apiKeys(), pool.pool);
}

export { corsPreflight as OPTIONS };
