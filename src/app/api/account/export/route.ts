import { connection } from "next/server";
import { withUser } from "@/lib/authz";
import { buildAccountExport } from "@/lib/account-export";

/** Download the signed-in user's data as JSON. Session-authenticated; 401 when signed out. */
const exportAccount = withUser(async (user) => {
  const body = JSON.stringify(await buildAccountExport(user.id), null, 2);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="jobradar-export.json"',
      "Cache-Control": "no-store",
    },
  });
});

export async function GET() {
  await connection();
  return exportAccount();
}
