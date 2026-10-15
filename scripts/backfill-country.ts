import postgres from "postgres";
import { backfillCountries } from "../src/lib/country-backfill.ts";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set");

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  const n = await backfillCountries(
    async (text, values) => [...(await sql.unsafe(text, values as never[]))] as Record<string, unknown>[],
  );
  console.log(`backfilled country for ${n} listing(s)`);
} finally {
  await sql.end();
}
