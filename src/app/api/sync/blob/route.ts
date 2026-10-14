import { NextResponse } from "next/server";
import { blobStatus, drainBlobOps, uploadSnapshot } from "@/lib/blob-sync";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const maxDuration = 60;

/**
 * Blob convergence endpoint (see vercel.json cron + manual recovery).
 * Drains buffered op blobs into Neon, then publishes a fresh snapshot when
 * due. Same CRON_SECRET gate as /api/refresh/cron.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const status = blobStatus();
  if (!status.configured) {
    return NextResponse.json(
      { error: "blob-disabled", hint: "Connect a Vercel Blob store (private) to enable file backup." },
      { status: 503 },
    );
  }

  const drain = await drainBlobOps({ force: true });
  const snapshot = await uploadSnapshot();
  return NextResponse.json({ drain, snapshot, status: blobStatus() });
}
