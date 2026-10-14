import { apiKeys } from "@/lib/api/keys-store";
import { corsPreflight, loadListingsPoolSafe, metaResponse } from "@/lib/api/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return metaResponse(request, apiKeys(), loadListingsPoolSafe);
}

export { corsPreflight as OPTIONS };
