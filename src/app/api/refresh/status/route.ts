import { connection, NextResponse } from "next/server";
import { readCurrentRun } from "@/lib/refresh-run-store";
import { AuthError, requireAdmin } from "@/lib/authz";

/**
 * Snapshot of the running (or last finished) refresh run. Run state is
 * mirrored to the database by the executing instance, so this works no
 * matter which serverless instance serves the poll. Admin-only.
 */
export async function GET() {
  await connection();
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { error: err.status === 401 ? "unauthorized" : "forbidden" },
        { status: err.status },
      );
    }
    throw err;
  }
  return NextResponse.json({ run: await readCurrentRun() });
}
