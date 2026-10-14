import { connection } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { buildAccountExport } from "@/lib/account-export";

/** Download the signed-in user's data as JSON. Session-authenticated; 401 when signed out. */
export async function GET() {
  await connection();
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const body = JSON.stringify(await buildAccountExport(user.id), null, 2);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="jobradar-export.json"',
      "Cache-Control": "no-store",
    },
  });
}
