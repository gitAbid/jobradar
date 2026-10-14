import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetCronAuthWarning, isAuthorizedCron } from "@/lib/cron-auth";

const req = (auth?: string) =>
  new Request("http://localhost/api/x", { headers: auth ? { authorization: auth } : {} });

describe("isAuthorizedCron", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    _resetCronAuthWarning();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
    vi.restoreAllMocks();
  });

  it("rejects everything when the secret is unset, and logs once", () => {
    delete process.env.CRON_SECRET;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(isAuthorizedCron(req("Bearer "))).toBe(false);
    expect(isAuthorizedCron(req())).toBe(false);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it("rejects when the secret is empty", () => {
    process.env.CRON_SECRET = "";
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(isAuthorizedCron(req("Bearer "))).toBe(false);
  });

  it("rejects a wrong secret of the same length", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isAuthorizedCron(req("Bearer s3creX"))).toBe(false);
  });

  it("rejects a wrong-length or missing header", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isAuthorizedCron(req("Bearer s3cret-longer"))).toBe(false);
    expect(isAuthorizedCron(req("Bearer s3"))).toBe(false);
    expect(isAuthorizedCron(req())).toBe(false);
  });

  it("accepts the correct secret", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isAuthorizedCron(req("Bearer s3cret"))).toBe(true);
  });
});
