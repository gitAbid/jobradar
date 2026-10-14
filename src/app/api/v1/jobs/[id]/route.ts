import { apiKeys } from "@/lib/api/keys-store";
import { corsPreflight, jobDetailResponse, loadFeedSafe } from "@/lib/api/jobs";


export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return jobDetailResponse(request, apiKeys(), id, loadFeedSafe);
}

export { corsPreflight as OPTIONS };
