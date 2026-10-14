import { redirect } from "next/navigation";
import { connection } from "next/server";
import { bdPresetUrl } from "@/lib/bd";

export const metadata = { title: "Bangladesh jobs" };

/** Legacy URL: Bangladesh is now a location preset on the main feed. */
export default async function BangladeshRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  redirect(bdPresetUrl(await searchParams));
}
