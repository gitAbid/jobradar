import { connection } from "next/server";
import { probeRemote } from "@/db/remote";
import { usageLastHour } from "@/db/usage";

// Public + unauthenticated: reuse a recent probe so hammering this route
// can't keep the Neon compute awake (CU-hours) or inflate the counters.
const PROBE_TTL_MS = 30_000;
let lastProbe: { at: number; up: boolean } | null = null;

/** Public liveness + Neon usage surface. No error strings, nothing sensitive. */
export async function GET() {
  await connection();
  let up: boolean;
  if (lastProbe && Date.now() - lastProbe.at < PROBE_TTL_MS) {
    up = lastProbe.up;
  } else {
    try {
      up = await probeRemote();
    } catch {
      up = false;
    }
    lastProbe = { at: Date.now(), up };
  }
  return Response.json(
    { db: up ? "up" : "down", ...usageLastHour() },
    { status: up ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
