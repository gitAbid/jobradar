import { apiKeys } from "@/lib/api/keys-store";
import { corsPreflight, loadListingsPool, metaResponse } from "@/lib/api/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return metaResponse(request, apiKeys(), await loadListingsPool());
}

export { corsPreflight as OPTIONS };
