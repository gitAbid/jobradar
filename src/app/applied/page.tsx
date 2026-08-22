import { getDb, rowToListing, listFollowedCompanies } from "@/db";
import type { FilterableListing, ListingStatus } from "@/lib/types";
import {
  addUserTagAction,
  removeUserTagAction,
  setListingStatusAction,
  toggleFollowCompanyAction,
} from "@/app/actions";
import { Heart, Send, X, Star } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

const COLUMNS: Array<{ status: ListingStatus; title: string; icon: React.ReactNode }> = [
  { status: "favorite", title: "Favorite", icon: <Heart className="h-4 w-4" /> },
  { status: "applied", title: "Applied", icon: <Send className="h-4 w-4" /> },
];

/** Max cards rendered per column — keeps the page hydrating in milliseconds. */
const COLUMN_LIMIT = 50;

export default async function AppliedPage() {
  await connection(); // request-time rendering
  const db = getDb();

  // Accurate totals per column (cheap aggregate).
  const totals = new Map<string, number>(
    (
      db
        .prepare(
          `SELECT status, COUNT(*) AS n FROM listings
           WHERE status IN ('favorite','applied') GROUP BY status`,
        )
        .all() as Array<{ status: string; n: number }>
    ).map((r) => [r.status, r.n]),
  );

  // Cap each column: hydrating thousands of cards blocks the page for seconds.
  const itemsByStatus = new Map<string, FilterableListing[]>(
    COLUMNS.map((col) => {
      const rows = db
        .prepare(
          `SELECT l.*, b.name AS board_name
           FROM listings l JOIN boards b ON b.id = l.board_id
           WHERE l.status = ?
           ORDER BY COALESCE(l.posted_at, l.fetched_at) DESC
           LIMIT ${COLUMN_LIMIT}`,
        )
        .all(col.status) as Record<string, unknown>[];
      return [col.status, rows.map((r) => rowToListing(r as never)) as FilterableListing[]];
    }),
  );

  const followedCompanies = new Set(listFollowedCompanies(db).map((n) => n.toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Pipeline</h1>
        <p className="text-sm text-slate-500">
          Your saved jobs — favorite and applied. Favorite new finds from the{" "}
          <Link href="/" className="underline">
            Dashboard
          </Link>{" "}
          job list; they show up here.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {COLUMNS.map((col) => {
          const items = itemsByStatus.get(col.status) ?? [];
          const total = totals.get(col.status) ?? 0;
          return (
            <section key={col.status} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-100/60 p-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                {col.icon} {col.title}
                <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">
                  {total}
                </span>
              </h2>

              {items.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">
                  Nothing here yet
                </p>
              )}

              {items.map((l) => (
                <PipelineCard key={l.id} listing={l} followedCompanies={followedCompanies} />
              ))}

              {total > items.length && (
                <p className="text-center text-[11px] text-slate-400">
                  Showing latest {items.length} of {total} —{" "}
                  <Link href={`/?status=${col.status}`} className="underline">
                    view all
                  </Link>
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function StatusButton({
  id,
  status,
  active,
  children,
}: {
  id: number;
  status: ListingStatus;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <form action={setListingStatusAction} className="flex-1">
      <input type="hidden" name="id" value={id} />
      {/* clicking the active status removes the job from the board (back to new) */}
      <input type="hidden" name="status" value={active ? "new" : status} />
      <button
        type="submit"
        title={active ? "Remove from board" : undefined}
        className={`w-full inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-1 text-xs transition ${
          active
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
        }`}
      >
        {children}
      </button>
    </form>
  );
}

function PipelineCard({
  listing,
  followedCompanies,
}: {
  listing: FilterableListing;
  followedCompanies: Set<string>;
}) {
  const isFollowed = followedCompanies.has(listing.company.toLowerCase());

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <a
        href={listing.url}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-semibold leading-snug hover:underline"
      >
        {listing.title}
      </a>
      <div className="text-xs text-slate-500">
        {listing.company || "—"} · {listing.boardName}
      </div>

      {/* company follow toggle */}
      {listing.company && (
        <form action={toggleFollowCompanyAction} className="inline self-start">
          <input type="hidden" name="company" value={listing.company} />
          <button
            title={isFollowed ? `Unfollow ${listing.company}` : `Follow ${listing.company} for new openings`}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition ${
              isFollowed
                ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            }`}
          >
            <Star className={`h-3 w-3 ${isFollowed ? "fill-current" : ""}`} />
            {isFollowed ? "Following" : "Follow"}
          </button>
        </form>
      )}

      {/* user tags */}
      <div className="flex flex-wrap items-center gap-1">
        {listing.userTags.map((t) => (
          <form key={t} action={removeUserTagAction} className="inline">
            <input type="hidden" name="id" value={listing.id} />
            <input type="hidden" name="tag" value={t} />
            <button className="inline-flex items-center gap-0.5 rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] text-violet-700 hover:bg-violet-200">
              #{t} <X className="h-2.5 w-2.5" />
            </button>
          </form>
        ))}
        <form action={addUserTagAction} className="inline-flex items-center">
          <input type="hidden" name="id" value={listing.id} />
          <input
            name="tag"
            placeholder="+ tag"
            maxLength={40}
            className="w-16 rounded-md border border-dashed border-slate-300 px-1.5 py-0.5 text-[11px] focus:w-24 focus:outline-none"
          />
        </form>
      </div>

      <div className="mt-auto flex items-center gap-1.5 pt-1">
        <StatusButton id={listing.id} status="favorite" active={listing.status === "favorite"}>
          <Heart className={`h-3.5 w-3.5 ${listing.status === "favorite" ? "fill-current" : ""}`} />
          Favorite
        </StatusButton>
        <StatusButton id={listing.id} status="applied" active={listing.status === "applied"}>
          <Send className="h-3.5 w-3.5" /> Applied
        </StatusButton>
      </div>
    </article>
  );
}
