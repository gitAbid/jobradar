import { connection, NextResponse } from "next/server";
import { readCurrentRun } from "@/lib/refresh-run-store";


/**
 * Snapshot of the running (or last finished) refresh run. Run state is
 * mirrored to the database by the executing instance, so this works no
 * matter which serverless instance serves the poll.
 */
export async function GET() {
  await connection();
  return NextResponse.json({ run: await readCurrentRun() });
}
