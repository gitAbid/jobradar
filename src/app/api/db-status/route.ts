import { dbStatus } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health surface for the local-first data layer: where reads are served
 * from, whether the remote (Neon) is reachable, how many writes are queued
 * for replay, and when the on-device mirror was last refreshed.
 */
export async function GET() {
  const status = await dbStatus();
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
