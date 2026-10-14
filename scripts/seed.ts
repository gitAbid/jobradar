import postgres from "postgres";
import { SEED_BOARDS } from "../src/db/seed.ts";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set");

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  await sql.unsafe(
    `insert into boards (name, type, url, filter_keywords, enabled)
     select name, type, url, filter_keywords::jsonb, enabled from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::boolean[]) as t(name, type, url, filter_keywords, enabled)
     on conflict (name) do nothing`,
    [
      SEED_BOARDS.map((b) => b.name),
      SEED_BOARDS.map((b) => b.type),
      SEED_BOARDS.map((b) => b.url),
      SEED_BOARDS.map((b) => JSON.stringify(b.keywords)),
      SEED_BOARDS.map((b) => b.enabled !== false),
    ] as never[],
  );
  console.log(`seeded ${SEED_BOARDS.length} board(s) (existing left untouched)`);
} finally {
  await sql.end();
}
