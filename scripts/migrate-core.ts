import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Project-global advisory lock key; do not reuse elsewhere. */
export const MIGRATION_LOCK_KEY = 74_201;

// Minimal structural types so tests can drive the runner with a fake.
export interface MigrateTx {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  unsafe: (text: string) => Promise<unknown>;
}
export interface MigrateSql {
  begin: <T>(fn: (tx: MigrateTx) => Promise<T>) => Promise<T>;
}

/**
 * Apply unapplied `*.sql` files from `dir` in name order, all inside one
 * transaction holding an advisory lock. Returns the names applied.
 */
export async function migrate(
  sql: MigrateSql,
  dir: string,
  log: (msg: string) => void = () => {},
): Promise<string[]> {
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`;
    await tx`create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now())`;
    const rows = (await tx`select name from schema_migrations`) as {
      name: string;
    }[];
    const done = new Set(rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      log(`applying ${f}`);
      await tx.unsafe(await readFile(join(dir, f), "utf8"));
      await tx`insert into schema_migrations (name) values (${f})`;
      applied.push(f);
    }
  });
  return applied;
}
