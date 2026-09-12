import { NextResponse } from "next/server";
import { after } from "next/server";
import { startRefreshRun } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled-refresh entrypoint for Vercel Cron (see vercel.json). Vercel
 * sends "Authorization: Bearer $CRON_SECRET" on cron invocations when the
 * CRON_SECRET env var is set; reject anything else.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = await startRefreshRun(undefined, "scheduled");
  if (started === null) {
    return NextResponse.json({ error: "already_running" }, { status: 409 });
  }

  after(() => started.done);

  return NextResponse.json(
    { runId: started.run.id, boardCount: started.run.boards.length, startedAt: started.run.startedAt },
    { status: 202 },
  );
}
