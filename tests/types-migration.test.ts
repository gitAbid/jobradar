import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  insertListings,
  persistEnrichment,
  q,
  rowToBoard,
  rowToListing,
  setRemoteHarness,
} from "../src/db";

const mig = (f: string) => readFileSync(join(process.cwd(), "db/migrations", f), "utf8");

let db: PGlite;
afterEach(async () => {
  setRemoteHarness(null);
  await db.close();
});

describe("004_types migration", () => {
  it("converts legacy text rows, tolerating garbage, and mappers/writes keep the TS types", async () => {
    db = new PGlite();
    for (const f of ["001_baseline.sql", "002_feed_index.sql", "003_country.sql"]) await db.exec(mig(f));
    await db.exec(`
      insert into boards (name, type, url, enabled, filter_keywords, last_fetched_at)
        values ('A','api','http://a',0,'["x","y"]','2026-09-10T01:02:03.000Z'),
               ('B','api','http://b',1,'not json',null);
      insert into listings (board_id, external_id, title, is_remote, visa_sponsorship, tags, skills,
                            user_tags, url, posted_at, deadline, fetched_at)
        values (1,'e1','T1',1,0,'["a"]','["Java"]','["mine"]','u','2026-09-09T00:00:00Z','garbage','2026-09-10T00:00:00.000Z'),
               (1,'e2','T2',0,1,'{"a":1}','','[]','u','','','2026-09-11 10:00:00');
      insert into api_keys (name, key_hash, prefix, created_at, revoked_at)
        values ('k','h','p','2026-09-01T00:00:00.000Z','nope');
      insert into followed_companies (name, created_at) values ('Acme','bad');
    `);
    await db.exec(mig("004_types.sql"));

    const boards = (await db.query("select * from boards order by id")).rows as never[];
    expect(rowToBoard(boards[0])).toMatchObject({
      enabled: false,
      filterKeywords: ["x", "y"],
      lastFetchedAt: "2026-09-10T01:02:03.000Z",
    });
    expect(rowToBoard(boards[1])).toMatchObject({ enabled: true, filterKeywords: [], lastFetchedAt: null });

    const ls = (await db.query("select * from listings order by id")).rows as never[];
    expect(rowToListing(ls[0])).toMatchObject({
      isRemote: true,
      visaSponsorship: false,
      tags: ["a"],
      skills: ["Java"],
      userTags: ["mine"],
      postedAt: "2026-09-09T00:00:00.000Z",
      deadline: null,
      fetchedAt: "2026-09-10T00:00:00.000Z",
    });
    expect(rowToListing(ls[1])).toMatchObject({
      isRemote: false,
      visaSponsorship: true,
      tags: [],
      skills: [],
      postedAt: null,
      fetchedAt: "2026-09-11T10:00:00.000Z",
    });

    const types = (
      await db.query(
        `select table_name||'.'||column_name as c, data_type from information_schema.columns
          where table_name in ('boards','listings','api_keys','followed_companies','pinned_countries')
            and data_type in ('timestamp with time zone','boolean','jsonb')`,
      )
    ).rows.map((r) => (r as { c: string }).c);
    expect(types).toEqual(
      expect.arrayContaining([
        "boards.enabled", "boards.filter_keywords", "boards.last_fetched_at",
        "listings.is_remote", "listings.visa_sponsorship", "listings.tags", "listings.skills",
        "listings.user_tags", "listings.posted_at", "listings.deadline", "listings.fetched_at",
        "api_keys.created_at", "api_keys.last_used_at", "api_keys.revoked_at",
        "followed_companies.created_at", "pinned_countries.created_at",
      ]),
    );
    // defaults restored, helper functions gone, feed index rebuilt
    await db.exec("insert into boards (name,type,url) values ('C','api','u')");
    const c = (await db.query("select enabled, filter_keywords from boards where name='C'")).rows[0];
    expect(c).toEqual({ enabled: true, filter_keywords: [] });
    const fns = await db.query("select 1 from pg_proc where proname like '_mig_%'");
    expect(fns.rows).toHaveLength(0);
    const idx = await db.query("select 1 from pg_indexes where indexname = 'idx_listings_feed'");
    expect(idx.rows).toHaveLength(1);
  });

  it("insertListings/persistEnrichment write typed values; bad dates become null", async () => {
    db = new PGlite();
    for (const f of ["001_baseline.sql", "002_feed_index.sql", "003_country.sql", "004_types.sql"])
      await db.exec(mig(f));
    setRemoteHarness({
      query: async (sql, params) => (await db.query(sql, params)).rows as Record<string, unknown>[],
      run: async (sql, params) => (await db.query(sql, params)).affectedRows ?? 0,
    });
    await db.exec("insert into boards (name,type,url) values ('A','api','u')");
    const base = {
      company: "Acme", location: "Remote", isRemote: true, visaSponsorship: false, remoteScope: null,
      tags: '["t"]', skills: "[]", url: "http://x", deadline: null,
      fetchedAt: "2026-09-15T00:00:00.000Z", searchText: "", description: "",
    };
    await insertListings(1, [
      { ...base, externalId: "1", title: "One", postedAt: "2026-09-01T00:00:00Z" },
      { ...base, externalId: "2", title: "Two", postedAt: "last tuesday" },
    ]);
    await persistEnrichment(1, [
      { externalId: "1", searchText: "s", skills: '["Go"]', description: "d", visaSponsorship: true, deadline: "2026-12-01" },
    ]);
    const rows = await q<Record<string, unknown>>("select * from listings order by id");
    expect(rowToListing(rows[0] as never)).toMatchObject({
      isRemote: true,
      visaSponsorship: true,
      tags: ["t"],
      skills: ["Go"],
      postedAt: "2026-09-01T00:00:00.000Z",
      deadline: "2026-12-01T00:00:00.000Z",
    });
    expect(rowToListing(rows[1] as never).postedAt).toBeNull();
  });
});
