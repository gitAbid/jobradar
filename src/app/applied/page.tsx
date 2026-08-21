import { getDb, rowToListing } from "@/db";
import type { FilterableListing, ListingStatus } from "@/lib/types";
import { addUserTagAction, removeUserTagAction, setListingStatusAction } from "@/app/actions";
import { Heart, Send, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

const COLUMNS: Array<{ status: ListingStatus; title: string; icon: React.ReactNode }> = [
  { status: "new", title: "New", icon: <RotateCcw className="h-4 w-4" /> },
  { status: "favorite", title: "Favorite", icon: <Heart className="h-4 w-4" /> },
  { status: "applied", title: "Applied", icon: <Send className="h-4 w-4" /> },
];

export default async function AppliedPage() {
  await connection(); // request-time rendering
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT l.*, b.name AS board_name
       FROM listings l JOIN boards b ON b.id = l.board_id
       WHERE l.status IN ('new','favorite','applied')
       ORDER BY COALESCE(l.posted_at, l.fetched_at) DESC`,
    )
    .all() as Record<string, unknown>[];

  const listings = rows.map((r) => rowToListing(r as never)) as FilterableListing[];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Pipeline</h1>
        <p className="text-sm text-slate-500">
          Track what you care about. Hidden jobs are excluded —{" "}
          <Link href="/?status=hidden" className="underline">
            view hidden
          </Link>
          .
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = listings.filter((l) => l.status === col.status);
          return (
            <section key={col.status} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-100/60 p-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                {col.icon} {col.title}
                <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">
                  {items.length}
                </span>
              </h2>

              {items.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">
                  Nothing here yet
                </p>
              )}

              {items.map((l) => (
                <PipelineCard key={l.id} listing={l} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function PipelineCard({ listing }: { listing: FilterableListing }) {
  const nextStatus =
    listing.status === "new" ? "favorite" : listing.status === "favorite" ? "applied" : "new";

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

      <form action={setListingStatusAction} className="mt-auto pt-1">
        <input type="hidden" name="id" value={listing.id} />
        <input type="hidden" name="status" value={nextStatus} />
        <button className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-slate-400">
          Move to{" "}
          {nextStatus === "favorite" ? "❤️ Favorite" : nextStatus === "applied" ? "📤 Applied" : "↩️ New"}
        </button>
      </form>
    </article>
  );
}
