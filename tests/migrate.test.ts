import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, MIGRATION_LOCK_KEY } from "../scripts/migrate-core";

function fakeSql() {
  const applied = new Set<string>();
  const log: string[] = [];
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      log.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
      if (text.includes("pg_advisory_xact_lock")) {
        expect(values[0]).toBe(MIGRATION_LOCK_KEY);
        return [];
      }
      if (text.includes("select name from schema_migrations"))
        return [...applied].map((name) => ({ name }));
      if (text.includes("insert into schema_migrations"))
        applied.add(values[0] as string);
      return [];
    },
    {
      unsafe: async (t: string) => {
        log.push(`unsafe:${t.trim()}`);
      },
    },
  );
  return { sql: { begin: async (fn: never) => (fn as (t: typeof tx) => unknown)(tx) } as never, log };
}

describe("migrate", () => {
  it("locks first, applies in name order, and is a no-op the second time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mig-"));
    await writeFile(join(dir, "002_b.sql"), "select 2;");
    await writeFile(join(dir, "001_a.sql"), "select 1;");
    await writeFile(join(dir, "notes.txt"), "ignore");
    const { sql, log } = fakeSql();
    expect(await migrate(sql, dir)).toEqual(["001_a.sql", "002_b.sql"]);
    expect(log[0]).toContain("select pg_advisory_xact_lock");
    expect(log.filter((l) => l.startsWith("unsafe:"))).toEqual([
      "unsafe:select 1;",
      "unsafe:select 2;",
    ]);
    log.length = 0;
    expect(await migrate(sql, dir)).toEqual([]);
    expect(log.some((l) => l.startsWith("unsafe:"))).toBe(false);
  });
});
