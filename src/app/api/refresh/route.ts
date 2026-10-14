import { NextResponse } from "next/server";
import { after } from "next/server";
import { startRefreshRun } from "@/lib/refresh";
import { getRun } from "@/lib/refresh-run";
import { AuthError, requireAdmin } from "@/lib/authz";

export const maxDuration = 60;

/** Reject cross-site browser form/fetch posts (public URL, personal app). */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser client
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

/**
 * Starts a refresh and returns immediately (202); the run keeps going on the
 * server no matter what the client does next — `after()` holds the serverless
 * invocation open until it finishes. Progress: GET ./status.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    await requireAdmin(); // manual refresh is admin-only (cron has its own route)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { error: err.status === 401 ? "unauthorized" : "forbidden" },
        { status: err.status },
      );
    }
    throw err;
  }

  let boardId: number | undefined;
  try {
    const body = (await request.json()) as { boardId?: number } | null;
    if (body && Number.isInteger(body.boardId)) boardId = body.boardId;
  } catch {
    // no / invalid body → refresh everything
  }

  const started = await startRefreshRun(boardId, "manual");
  if (started === null) {
    return NextResponse.json({ error: "already_running", run: getRun() }, { status: 409 });
  }

  after(() => started.done);

  return NextResponse.json(
    { runId: started.run.id, boardCount: started.run.boards.length, startedAt: started.run.startedAt },
    { status: 202 },
  );
}
