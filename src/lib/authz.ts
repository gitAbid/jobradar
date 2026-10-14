import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string = status === 401 ? "unauthorized" : "forbidden",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface SessionUser {
  id: string;
  email: string;
  role: "admin" | "user";
}

/** Current user or null. Deduped per render pass (not a cross-request cache). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.email) return null;
  return { id: u.id, email: u.email, role: u.role === "admin" ? "admin" : "user" };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError(401);
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError(403);
  return user;
}

/** Page guard: anonymous → /signin. Call after `await connection()`. */
export async function requirePageUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  return user;
}

/** Page guard for admin-only pages: anonymous → /signin, non-admin → 404. */
export async function requirePageAdmin(): Promise<SessionUser> {
  const user = await requirePageUser();
  if (user.role !== "admin") notFound();
  return user;
}
