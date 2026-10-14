import { apiKeys } from "@/lib/api/keys-store";
import { corsPreflight, jobsListResponse, loadFeedSafe } from "@/lib/api/jobs";


export async function GET(request: Request) {
  return jobsListResponse(request, apiKeys(), loadFeedSafe);
}

export { corsPreflight as OPTIONS };
