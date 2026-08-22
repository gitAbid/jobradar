import { connection } from "next/server";
import Link from "next/link";
import { getDb, rowToListing, listFollowedCompanies } from "@/db";
import { toggleFollowCompanyAction } from "@/app/actions";
import { ListingCard } from "@/components/ListingCard";
import { X, Star } from "lucide-react";
import type { FilterableListing } from "@/lib/types";

const FOLLOWING_LIMIT = 200;

interface SearchParams {
  company?: string;
}

export default async function FollowingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await connection(); // request-time rendering
  const sp = await searchParams;
  const db = getDb();

  const followed = listFollowedCompanies(db);
  const selected = sp.company?.trim();
  // only accept a filter that matches a followed company (case-insensitive)
  const activeCompany =
    selected && followed.some((n) => n.toLowerCase() === selected.toLowerCase())
      ? followed.find((n) => n.toLowerCase() === selected.toLowerCase())!
      : null;

  // Openings whose company is followed, newest first.
  // Capped: a prolific company shouldn't produce an unbounded page.
  const rows = followed.length
    ? (db
        .prepare(
          `SELECT l.*, b.name AS board_name
           FROM listings l JOIN boards b ON b.id = l.board_id
           WHERE EXISTS (
             SELECT 1 FROM followed_companies fc
             WHERE fc.name = l.company COLLATE NOCASE
           )
           ${activeCompany ? "AND l.company = ? COLLATE NOCASE" : ""}
           ORDER BY COALESCE(l.posted_at, l.fetched_at) DESC
           LIMIT ${FOLLOWING_LIMIT}`,
        )
        .all(...(activeCompany ? [activeCompany] : [])) as Record<string, unknown>[])
    : [];

  const listings = rows.map((r) => rowToListing(r as never)) as FilterableListing[];
  const followedSet = new Set(followed.map((n) => n.toLowerCase()));

  // Accurate per-company opening counts (unaffected by the feed cap above).
  const counts = new Map<string, number>(
    (
      db
        .prepare(
          `SELECT l.company AS company, COUNT(*) AS n
           FROM listings l JOIN followed_companies f ON f.name = l.company COLLATE NOCASE
           GROUP BY l.company COLLATE NOCASE`,
        )
        .all() as Array<{ company: string; n: number }>
    ).map((r) => [r.company.toLowerCase(), r.n]),
  );
  const totalCount = [...counts.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Following</h1>
        <p className="text-sm text-slate-500">
          Current openings from companies you follow. Follow more via the star on any company
          badge on the <Link href="/" className="underline">Dashboard</Link>.
        </p>
      </div>

      {followed.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {/* All */}
          <Link
            href="/following"
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
              !activeCompany
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
            }`}
          >
            All · {totalCount}
          </Link>

          {followed.map((name) => {
            const isActive = activeCompany?.toLowerCase() === name.toLowerCase();
            return (
              <span
                key={name}
                className={`inline-flex items-center overflow-hidden rounded-full border text-xs transition ${
                  isActive
                    ? "border-amber-400 bg-amber-100 text-amber-900"
                    : "border-amber-300 bg-amber-50 text-amber-800"
                }`}
              >
                <Link
                  href={`/following?company=${encodeURIComponent(name)}`}
                  title={`Show only ${name} openings`}
                  className="inline-flex items-center gap-1 py-0.5 pl-2 pr-1"
                >
                  <Star
                    className={`h-3 w-3 ${
                      isActive ? "fill-current text-amber-600" : "fill-current text-amber-500"
                    }`}
                  />
                  {name}
                  <span className={isActive ? "text-amber-700" : "text-amber-600"}>
                    · {counts.get(name.toLowerCase()) ?? 0}
                  </span>
                </Link>
                <form action={toggleFollowCompanyAction}>
                  <input type="hidden" name="company" value={name} />
                  <button
                    type="submit"
                    title={`Unfollow ${name}`}
                    className={`p-1 pr-1.5 transition hover:text-red-600 ${
                      isActive ? "text-amber-700" : "text-amber-400"
                    }`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </form>
              </span>
            );
          })}
        </div>
      )}

      {followed.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          You&apos;re not following any companies yet. Tap the star on a company&apos;s badge on
          any job card to track their openings here.
        </div>
      ) : listings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          No current openings from{" "}
          <strong>{activeCompany}</strong>.{" "}
          <Link href="/following" className="underline">
            View all followed companies
          </Link>{" "}
          or hit <strong>Refresh now</strong> on the{" "}
          <Link href="/" className="underline">Dashboard</Link> to check for new ones.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {activeCompany && (
            <p className="text-xs text-slate-500">
              Showing openings from <strong>{activeCompany}</strong> only —{" "}
              <Link href="/following" className="underline">
                show all
              </Link>
            </p>
          )}
          {listings.map((l) => (
            <ListingCard
              key={l.id}
              listing={l}
              matched={[]}
              followedCompanies={followedSet}
            />
          ))}
          {!activeCompany && listings.length >= FOLLOWING_LIMIT && (
            <p className="text-center text-xs text-slate-400">
              Showing the latest {FOLLOWING_LIMIT} openings.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
