import { connection, NextResponse } from "next/server";
import { readCurrentRun } from "@/lib/refresh-run-store";
import { withAdmin } from "@/lib/authz";

/**
 * Snapshot of the running (or last finished) refresh run. Run state is
 * mirrored to the database by the executing instance, so this works no
 * matter which serverless instance serves the poll. Admin-only.
 */
const status = withAdmin(async () => NextResponse.json({ run: await readCurrentRun() }));

export async function GET() {
  await connection();
  return status();
}
