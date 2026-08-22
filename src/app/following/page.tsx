import { connection } from "next/server";
import { getDb, rowToListing, listFollowedCompanies } from "@/db";
import { toggleFollowCompanyAction } from "@/app/actions";
import { ListingCard } from "@/components/ListingCard";
import { X, Star } from "lucide-react";
import Link from "next/link";
import type { FilterableListing } from "@/lib/types";

export default async function FollowingPage() {
  await connection(); // request-time rendering
  const db = getDb();

  const followed = listFollowedCompanies(db);

  // Openings whose company is followed, newest first.
  // Capped: a prolific company shouldn't produce an unbounded page.
  const FOLLOWING_LIMIT = 200;
  const rows = followed.length
    ? (db
        .prepare(
          `SELECT l.*, b.name AS board_name
           FROM listings l JOIN boards b ON b.id = l.board_id
           WHERE EXISTS (
             SELECT 1 FROM followed_companies fc
             WHERE fc.name = l.company COLLATE NOCASE
           )
           ORDER BY COALESCE(l.posted_at, l.fetched_at) DESC
           LIMIT ${FOLLOWING_LIMIT}`,
        )
        .all() as Record<string, unknown>[])
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
          {followed.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800"
            >
              <Star className="h-3 w-3 fill-current text-amber-500" />
              {name}
              <span className="text-amber-600">· {counts.get(name.toLowerCase()) ?? 0}</span>
              <form action={toggleFollowCompanyAction} className="inline">
                <input type="hidden" name="company" value={name} />
                <button
                  type="submit"
                  title={`Unfollow ${name}`}
                  className="rounded-full p-0.5 text-amber-500 hover:bg-amber-200 hover:text-amber-800"
                >
                  <X className="h-3 w-3" />
                </button>
              </form>
            </span>
          ))}
        </div>
      )}

      {followed.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          You&apos;re not following any companies yet. Tap the star on a company&apos;s badge on
          any job card to track their openings here.
        </div>
      ) : listings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          No current openings from your followed companies. Hit <strong>Refresh now</strong> on the{" "}
          <Link href="/" className="underline">Dashboard</Link> to check for new ones.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {listings.map((l) => (
            <ListingCard
              key={l.id}
              listing={l}
              matched={[]}
              followedCompanies={followedSet}
            />
          ))}
          {listings.length >= FOLLOWING_LIMIT && (
            <p className="text-center text-xs text-slate-400">
              Showing the latest {FOLLOWING_LIMIT} openings.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
