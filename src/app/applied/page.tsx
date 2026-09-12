import { listFollowedCompanies, q, rowToListing } from "@/db";
import type { FilterableListing, ListingStatus } from "@/lib/types";
import {
  addUserTagAction,
  removeUserTagAction,
  setListingStatusAction,
} from "@/app/actions";
import { ArrowRight, Heart, Send, X, Trash2 } from "lucide-react";
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

  // Accurate totals per column (cheap aggregate).
  const totals = new Map<string, number>(
    (
      await q<{ status: string; n: number }>(
        `select status, count(*) as n from listings
         where status in ('favorite','applied') group by status`,
      )
    ).map((r) => [r.status, r.n]),
  );

  // Cap each column: hydrating thousands of cards blocks the page for seconds.
  const itemsByStatus = new Map<string, FilterableListing[]>(
    await Promise.all(
      COLUMNS.map(async (col) => {
        const rows = await q<Record<string, unknown>>(
          `select l.*, b.name as board_name
           from listings l join boards b on b.id = l.board_id
           where l.status = $1
           order by coalesce(l.posted_at, l.fetched_at) desc
           limit ${COLUMN_LIMIT}`,
          [col.status],
        );
        return [col.status, rows.map((r) => rowToListing(r as never)) as FilterableListing[]] as const;
      }),
    ),
  );

  const followedCompanies = new Set((await listFollowedCompanies()).map((n) => n.toLowerCase()));
  const favoriteTotal = totals.get("favorite") ?? 0;
  const appliedTotal = totals.get("applied") ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-3xl bg-violet-50 px-5 py-6 sm:px-7 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-violet-800">
              <Heart className="h-3.5 w-3.5 fill-current" /> Application workspace
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-[-0.04em] text-slate-950 sm:text-4xl">Your pipeline</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-[15px]">
              Keep promising roles close, move applications forward, and clear out the ones that are no longer a fit.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            Find more jobs <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Favorites</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{favoriteTotal}</p>
          </div>
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Applied</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{appliedTotal}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {COLUMNS.map((col) => {
          const items = itemsByStatus.get(col.status) ?? [];
          const total = totals.get(col.status) ?? 0;
          const favorite = col.status === "favorite";
          return (
            <section
              key={col.status}
              className={`flex min-w-0 flex-col gap-3 rounded-2xl border p-3.5 sm:p-4 ${favorite ? "border-amber-200 bg-amber-50/55" : "border-teal-200 bg-teal-50/55"}`}
            >
              <div className="flex items-center gap-3 border-b border-current/10 pb-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${favorite ? "bg-amber-100 text-amber-700" : "bg-teal-100 text-teal-700"}`}>
                  {col.icon}
                </span>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">{col.title}</h2>
                  <p className="text-xs text-slate-500">{favorite ? "Worth a closer look" : "Applications in motion"}</p>
                </div>
                <span className="ml-auto rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600 shadow-sm">
                  {total}
                </span>
              </div>

              {items.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-6 text-center text-xs text-slate-500">
                  {favorite ? "Save a promising role from the Dashboard." : "Move a favorite here when you apply."}
                </p>
              )}

              {items.map((l) => (
                <PipelineCard key={l.id} listing={l} followedCompanies={followedCompanies} />
              ))}

              {total > items.length && (
                <p className="text-center text-[11px] font-medium text-slate-400">
                  Showing latest {items.length} of {total} —{" "}
                  <Link href={`/?status=${col.status}`} className="font-semibold text-teal-700 underline">
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
    <article className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-[0_6px_18px_rgb(15_42_67/0.05)] transition-shadow hover:shadow-[0_10px_24px_rgb(15_42_67/0.09)] sm:p-4">
      <a
        href={listing.url}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-bold leading-snug text-slate-950 hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        {listing.title}
      </a>
      {listing.company ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <CompanyBadge
            company={listing.company}
            followed={followedCompanies.has(listing.company.toLowerCase())}
          />
          <span className="rounded-full bg-slate-100 px-2 py-1 font-medium">{listing.boardName}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {listing.userTags.map((t) => (
          <form key={t} action={removeUserTagAction} className="inline">
            <input type="hidden" name="id" value={listing.id} />
            <input type="hidden" name="tag" value={t} />
            <button className="inline-flex min-h-8 items-center gap-0.5 rounded-lg border border-violet-100 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
              #{t} <X className="h-2.5 w-2.5" />
            </button>
          </form>
        ))}
        <form action={addUserTagAction} className="inline-flex items-center">
          <input type="hidden" name="id" value={listing.id} />
          <input
            name="tag"
            placeholder="+ tag"
            aria-label={`Add tag to ${listing.title}`}
            maxLength={40}
            className="min-h-8 w-20 rounded-lg border border-dashed border-slate-300 bg-white px-2 py-0.5 text-[11px] placeholder:text-slate-400 focus:w-28 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100"
          />
        </form>
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-slate-100 pt-3">
        <form action={setListingStatusAction} className="flex-1">
          <input type="hidden" name="id" value={listing.id} />
          <input type="hidden" name="status" value={otherStatus} />
          <button className="inline-flex min-h-10 w-full items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
            Move to {otherStatus === "favorite" ? "Favorite" : "Applied"}
            <ArrowRight className="h-3 w-3" />
          </button>
        </form>
        <form action={setListingStatusAction}>
          <input type="hidden" name="id" value={listing.id} />
          <input type="hidden" name="status" value="new" />
          <button
            type="submit"
            title="Remove from board"
            aria-label={`Remove ${listing.title} from pipeline`}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </article>
  );
}
