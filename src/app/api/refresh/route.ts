import { NextResponse } from "next/server";
import { refreshAll } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let boardId: number | undefined;
  try {
    const body = (await request.json()) as { boardId?: number } | null;
    if (body && Number.isInteger(body.boardId)) boardId = body.boardId;
  } catch {
    // no / invalid body → refresh everything
  }

  const summary = await refreshAll(boardId);
  return NextResponse.json(summary);
}
