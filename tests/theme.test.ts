import { describe, expect, it } from "vitest";
import { parseTheme, THEME_INIT_SCRIPT } from "@/lib/theme";

describe("theme", () => {
  it("falls back to system for unknown values", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("neon")).toBe("system");
    expect(parseTheme(null)).toBe("system");
  });
  it("init script only applies light/dark", () => {
    expect(THEME_INIT_SCRIPT).toContain('t==="light"||t==="dark"');
  });
});
