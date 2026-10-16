import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

import {
  attachDescriptions,
  insertListings,
  LISTING_POOL_SELECT,
  persistEnrichment,
  q,
  qDescriptionsByIds,
  qOne,
  rowToListing,
  run,
  setRemoteHarness,
} from "@/db";
import { bdPrefilterWhere, isBangladeshRelevant } from "@/lib/bd";
import { buildSearchText } from "@/lib/filters";
import type { FilterableListing } from "@/lib/types";

let db: PGlite;
let boardId: number;

const BIG = "lorem ipsum dolor sit amet ".repeat(800); // ~21KB per description

function makeRow(overrides: {
  externalId: string;
  title: string;
  location: string;
  description: string;
}) {
  const tags = '["java"]';
  return {
    externalId: overrides.externalId,
    title: overrides.title,
    company: "Acme",
    location: overrides.location,
    isRemote: false,
    visaSponsorship: false,
    remoteScope: null,
    tags,
    skills: '["Java"]',
    url: `https://example.com/${overrides.externalId}`,
    postedAt: null,
    deadline: null,
    fetchedAt: "2026-09-15T00:00:00.000Z",
    searchText: buildSearchText({
      title: overrides.title,
      company: "Acme",
      location: overrides.location,
      tags: ["java"],
      description: overrides.description,
    }),
    description: overrides.description,
  };
}

beforeEach(async () => {
  db = new PGlite();
  for (const file of readdirSync(join(process.cwd(), "db/migrations")).sort()) {
    if (file.endsWith(".sql")) {
      await db.exec(readFileSync(join(process.cwd(), "db/migrations", file), "utf8"));
    }
  }
  setRemoteHarness({
    query: async (sql, params) =>
      (await db.query(sql, params)).rows as Record<string, unknown>[],
    run: async (sql, params) => (await db.query(sql, params)).affectedRows ?? 0,
  });

  await run(
    "insert into boards (name, type, url, filter_keywords) values ($1, $2, $3, $4)",
    ["PoolBoard", "api", "https://example.com/api", "[]"],
  );
  boardId = Number(
    (await qOne<{ id: number }>("select id from boards where name = $1", ["PoolBoard"]))?.id,
  );

  await insertListings(boardId, [
    makeRow({
      externalId: "bd-dhaka",
      title: "Backend Engineer",
      location: "Dhaka, Bangladesh",
      description: `onsite role. ${BIG}`,
    }),
    makeRow({
      externalId: "bd-remote",
      title: "Remote Java Dev",
      location: "Remote",
      description: `We welcome candidates from Bangladesh and beyond. ${BIG}`,
    }),
    makeRow({
      externalId: "de-berlin",
      title: "Java Engineer",
      location: "Berlin, Germany",
      description: `Hybrid role in Berlin. ${BIG}`,
    }),
  ]);
});

afterEach(async () => {
  setRemoteHarness(null);
  await db.close();
});

describe("precomputed country", () => {
  it("is set on insert so the feed never falls back to its per-row CASE", async () => {
    const rows = await q<{ external_id: string; country: string | null }>(
      "select external_id, country from listings order by external_id",
    );
    expect(rows).toEqual([
      { external_id: "bd-dhaka", country: "Bangladesh" },
      { external_id: "bd-remote", country: "Remote · Anywhere" },
      { external_id: "de-berlin", country: "Germany" },
    ]);
  });

  it("is cleared when enrichment changes the location", async () => {
    await persistEnrichment(boardId, [
      { externalId: "de-berlin", searchText: "", skills: "[]", description: "", location: "Tokyo, Japan" },
    ]);
    const row = await qOne<{ country: string | null }>(
      "select country from listings where external_id = $1",
      ["de-berlin"],
    );
    expect(row?.country).toBeNull();
  });
});

describe("pruned listings pool", () => {
  it("never selects the heavy blobs", () => {
    expect(LISTING_POOL_SELECT).not.toMatch(/description/);
    expect(LISTING_POOL_SELECT).not.toMatch(/search_text/);
  });

  it("transfers a fraction of the full-row bytes", async () => {
    const full = await q<Record<string, unknown>>(
      `select l.*, b.name as board_name from listings l join boards b on b.id = l.board_id`,
    );
    const pruned = await q<Record<string, unknown>>(
      `select ${LISTING_POOL_SELECT}, b.name as board_name from listings l join boards b on b.id = l.board_id`,
    );
    expect(pruned).toHaveLength(3);
    expect(full).toHaveLength(3);
    for (const r of pruned) {
      expect(r).not.toHaveProperty("description");
      expect(r).not.toHaveProperty("search_text");
    }
    const bytes = (rows: Record<string, unknown>[]) =>
      rows.reduce((n, r) => n + JSON.stringify(r).length, 0);
    // 21KB descriptions × 3 rows dominate the full pull; the pruned pool
    // must stay under a tenth of it
    expect(bytes(pruned)).toBeLessThan(bytes(full) / 10);
  });

  it("fetches descriptions for visible rows on demand", async () => {
    const pruned = await q<Record<string, unknown>>(
      `select ${LISTING_POOL_SELECT}, b.name as board_name from listings l join boards b on b.id = l.board_id`,
    );
    const pool = pruned.map((r) => rowToListing(r as never)) as FilterableListing[];
    expect(pool.every((l) => l.description === "")).toBe(true);

    const byId = await qDescriptionsByIds(pool.map((l) => l.id));
    expect(byId.size).toBe(3);
    for (const l of pool) expect(byId.get(l.id)).toContain("lorem ipsum");

    const entries = pool.slice(0, 2).map((listing) => ({ listing, matched: [] as string[] }));
    await attachDescriptions(entries);
    expect(entries[0].listing.description).toContain("lorem ipsum");
    expect(entries[1].listing.description).toContain("lorem ipsum");
    expect(pool[2].description).toBe(""); // untouched rows stay pruned

    expect(await qDescriptionsByIds([])).toEqual(new Map());
    expect((await qDescriptionsByIds([999999])).size).toBe(0);
  });
});

describe("BD prefilter", () => {
  it("is a superset of the exact JS check and slashes scanned rows", async () => {
    const candidates = await q<Record<string, unknown>>(
      `select ${LISTING_POOL_SELECT}, l.search_text, b.name as board_name
       from listings l join boards b on b.id = l.board_id
       where ${bdPrefilterWhere()}`,
    );
    // superset: both BD rows in, Berlin out
    const ids = candidates.map((r) => r.external_id).sort();
    expect(ids).toEqual(["bd-dhaka", "bd-remote"]);

    // exact recheck is lossless on the subset
    const pool = candidates.map((r) => rowToListing(r as never)) as FilterableListing[];
    expect(pool.filter(isBangladeshRelevant)).toHaveLength(2);
  });
});
