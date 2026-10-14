import { apiKeys } from "@/lib/api/keys-store";
import { corsPreflight, loadFeedSafe, metaResponse } from "@/lib/api/jobs";


export async function GET(request: Request) {
  return metaResponse(request, apiKeys(), loadFeedSafe);
}

export { corsPreflight as OPTIONS };
