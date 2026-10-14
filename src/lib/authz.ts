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

// ── Shared gates for server actions and API routes ─────────────────────────

/** Caller-facing text for a failed gate: sign-in vs. not allowed, nothing more. */
export const AUTH_MESSAGES = { 401: "Sign in required", 403: "Not allowed" } as const;

export type Gate =
  | { ok: true; user: SessionUser }
  | { ok: false; status: 401 | 403; message: (typeof AUTH_MESSAGES)[401 | 403] };

/**
 * Auth gate for server actions. Each action maps a failure onto its own result
 * shape using `message`; nothing about the failure is leaked. Anything but an
 * AuthError is a bug and propagates.
 */
export async function gateAction(role: "user" | "admin" = "user"): Promise<Gate> {
  try {
    return { ok: true, user: await (role === "admin" ? requireAdmin() : requireUser()) };
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, status: err.status, message: AUTH_MESSAGES[err.status] };
    throw err;
  }
}

/** Route handler that receives the authenticated user ahead of its own arguments. */
type AuthedHandler<A extends unknown[]> = (user: SessionUser, ...args: A) => Promise<Response>;

function withRole<A extends unknown[]>(role: "user" | "admin", handler: AuthedHandler<A>) {
  return async (...args: A): Promise<Response> => {
    const g = await gateAction(role);
    if (!g.ok) {
      return Response.json(
        { error: g.status === 401 ? "unauthorized" : "forbidden" },
        { status: g.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return handler(g.user, ...args);
  };
}

/** Wrap an API route: anonymous → 401 `{ error: "unauthorized" }`. */
export function withUser<A extends unknown[]>(handler: AuthedHandler<A>) {
  return withRole("user", handler);
}

/** Wrap an admin-only API route: anonymous → 401, non-admin → 403 `{ error: "forbidden" }`. */
export function withAdmin<A extends unknown[]>(handler: AuthedHandler<A>) {
  return withRole("admin", handler);
}
