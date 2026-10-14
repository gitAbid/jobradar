import { apiKeys } from "@/lib/api/keys-store";
import { corsPreflight, jobDetailResponse, loadListingsPoolSafe } from "@/lib/api/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await loadListingsPoolSafe();
  if (!pool.ok) return pool.error;
  return jobDetailResponse(request, apiKeys(), id, pool.pool);
}

export { corsPreflight as OPTIONS };
