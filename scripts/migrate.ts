import postgres from "postgres";
import { join } from "node:path";
import { migrate } from "./migrate-core.ts";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set");

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const dir = join(import.meta.dirname, "..", "db", "migrations");

try {
  const applied = await migrate(sql as never, dir, console.log);
  console.log(applied.length ? `applied ${applied.length} migration(s)` : "up to date");
} finally {
  await sql.end();
}
