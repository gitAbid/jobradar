import { apiKeys } from "@/lib/api/keys-store";
import { corsPreflight, jobDetailResponse, loadListingsPoolSafe } from "@/lib/api/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return jobDetailResponse(request, apiKeys(), id, loadListingsPoolSafe);
}

export { corsPreflight as OPTIONS };
