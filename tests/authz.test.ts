import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
// React's cache() is request-scoped; make it a passthrough for tests
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

import { AuthError, requireAdmin, requireUser } from "@/lib/authz";

const user = (role: string) => ({ user: { id: "u1", email: "a@b.c", role } });

describe("authz", () => {
  beforeEach(() => authMock.mockReset());

  it("requireUser throws 401 when anonymous", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
    await expect(requireUser()).rejects.toBeInstanceOf(AuthError);
  });

  it("requireUser returns the user", async () => {
    authMock.mockResolvedValue(user("user"));
    expect(await requireUser()).toEqual({ id: "u1", email: "a@b.c", role: "user" });
  });

  it("requireAdmin throws 403 for non-admins and 401 for anonymous", async () => {
    authMock.mockResolvedValue(user("user"));
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
    authMock.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toMatchObject({ status: 401 });
  });

  it("requireAdmin passes for admins", async () => {
    authMock.mockResolvedValue(user("admin"));
    expect((await requireAdmin()).role).toBe("admin");
  });
});
