"use server";

import { signOut } from "@/auth";
import { run } from "@/db";
import { AuthError, requireUser } from "@/lib/authz";

export type DeleteAccountResult = { ok: false; error: string };

/**
 * Permanently delete the caller's account. Every user-owned table (accounts,
 * user_listing_state, user_settings, followed_companies, pinned_countries,
 * api_keys → api_rate) cascades from users, so one statement removes it all
 * atomically. Then sign out and land on `/`.
 */
export async function deleteAccountAction(): Promise<DeleteAccountResult | void> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, error: "Sign in required" };
    throw err;
  }
  try {
    await run("delete from users where id = $1", [user.id]);
  } catch (err) {
    console.error("[jobradar] delete account failed:", err);
    return { ok: false, error: "Couldn’t delete the account — try again shortly." };
  }
  await signOut({ redirectTo: "/" });
}
