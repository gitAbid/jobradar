import { cache } from "react";
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
