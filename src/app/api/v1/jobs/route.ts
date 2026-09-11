import { apiKeys } from "@/lib/api/keys-store";
import { corsPreflight, jobsListResponse, loadListingsPool } from "@/lib/api/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return jobsListResponse(request, apiKeys(), await loadListingsPool());
}

export { corsPreflight as OPTIONS };
