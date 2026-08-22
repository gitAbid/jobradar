import { getDb, rowToListing, listFollowedCompanies } from "@/db";
import type { FilterableListing, ListingStatus } from "@/lib/types";
import {
  addUserTagAction,
  removeUserTagAction,
  setListingStatusAction,
} from "@/app/actions";
import { Heart, Send, X, Trash2, ArrowRight } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { CompanyBadge } from "@/components/ListingCard";

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

function PipelineCard({
  listing,
  followedCompanies,
}: {
  listing: FilterableListing;
  followedCompanies: Set<string>;
}) {
  const otherStatus: ListingStatus = listing.status === "favorite" ? "applied" : "favorite";

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
      {/* company badge with follow toggle */}
      {listing.company ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <CompanyBadge
            company={listing.company}
            followed={followedCompanies.has(listing.company.toLowerCase())}
          />
          <span className="rounded-full bg-slate-100 px-2 py-0.5">{listing.boardName}</span>
        </div>
      ) : null}

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
        {/* single move button: sends the job to the other column */}
        <form action={setListingStatusAction} className="flex-1">
          <input type="hidden" name="id" value={listing.id} />
          <input type="hidden" name="status" value={otherStatus} />
          <button
            className="w-full inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 transition hover:border-slate-400"
          >
            Move to {otherStatus === "favorite" ? "Favorite" : "Applied"}
            <ArrowRight className="h-3 w-3" />
          </button>
        </form>
        {/* remove from board (back to new) */}
        <form action={setListingStatusAction}>
          <input type="hidden" name="id" value={listing.id} />
          <input type="hidden" name="status" value="new" />
          <button
            title="Remove from board"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </article>
  );
}
