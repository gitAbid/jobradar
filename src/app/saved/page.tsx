import { LISTING_POOL_SELECT, listFollowedCompanies, q, rowToListing, USER_STATE_SELECT, userStateJoin } from "@/db";
import { requirePageUser } from "@/lib/authz";
import type { FilterableListing, ListingStatus } from "@/lib/types";
import { ArrowRight, Heart, Send } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { PipelineCard } from "./PipelineCard";

export const metadata = { title: "Saved" };

const COLUMNS: Array<{ status: ListingStatus; title: string; icon: React.ReactNode }> = [
  { status: "favorite", title: "Favorite", icon: <Heart className="h-4 w-4" /> },
  { status: "applied", title: "Applied", icon: <Send className="h-4 w-4" /> },
];

/** Max cards rendered per column — keeps the page hydrating in milliseconds. */
const COLUMN_LIMIT = 50;

export default async function SavedPage() {
  await connection(); // request-time rendering
  const user = await requirePageUser();

  // Accurate totals per column (cheap aggregate).
  const totals = new Map<string, number>(
    (
      await q<{ status: string; n: number }>(
        `select status, count(*) as n from user_listing_state
         where user_id = $1::uuid and status in ('favorite','applied') group by status`,
        [user.id],
      )
    ).map((r) => [r.status, r.n]),
  );

  // Cap each column: hydrating thousands of cards blocks the page for seconds.
  const itemsByStatus = new Map<string, FilterableListing[]>(
    await Promise.all(
      COLUMNS.map(async (col) => {
        const rows = await q<Record<string, unknown>>(
          `select ${LISTING_POOL_SELECT}, ${USER_STATE_SELECT}, b.name as board_name
           from listings l join boards b on b.id = l.board_id
           ${userStateJoin("$1")}
           where s.status = $2
           order by coalesce(l.posted_at, l.fetched_at) desc
           limit ${COLUMN_LIMIT}`,
          [user.id, col.status],
        );
        return [col.status, rows.map((r) => rowToListing(r as never)) as FilterableListing[]] as const;
      }),
    ),
  );

  const followedCompanies = new Set((await listFollowedCompanies(user.id)).map((n) => n.toLowerCase()));
  const favoriteTotal = totals.get("favorite") ?? 0;
  const appliedTotal = totals.get("applied") ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-3xl bg-violet-soft px-5 py-6 sm:px-7 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-line bg-surface-raised/70 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-violet-ink">
              <Heart className="h-3.5 w-3.5 fill-current" /> Application workspace
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-[-0.04em] text-foreground sm:text-4xl">Saved jobs</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted sm:text-[15px]">
              Keep promising roles close, move applications forward, and clear out the ones that are no longer a fit.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            Find more jobs <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <div className="rounded-2xl bg-surface-raised px-4 py-3 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Favorites</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{favoriteTotal}</p>
          </div>
          <div className="rounded-2xl bg-surface-raised px-4 py-3 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Applied</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{appliedTotal}</p>
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
              className={`flex min-w-0 flex-col gap-3 rounded-2xl border p-3.5 sm:p-4 ${favorite ? "border-amber-line bg-amber-soft/55" : "border-teal-line bg-teal-soft/55"}`}
            >
              <div className="flex items-center gap-3 border-b border-current/10 pb-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${favorite ? "bg-amber-soft2 text-amber-ink" : "bg-teal-soft2 text-teal-ink"}`}>
                  {col.icon}
                </span>
                <div>
                  <h2 className="text-sm font-bold text-foreground">{col.title}</h2>
                  <p className="text-xs text-muted">{favorite ? "Worth a closer look" : "Applications in motion"}</p>
                </div>
                <span className="ml-auto rounded-full bg-surface-raised px-2.5 py-1 text-xs font-bold text-muted shadow-sm">
                  {total}
                </span>
              </div>

              {items.length === 0 && (
                <p className="rounded-xl border border-dashed border-border-strong bg-surface-raised/60 p-6 text-center text-xs text-muted">
                  {favorite ? "Save a promising role from Jobs." : "Move a favorite here when you apply."}
                </p>
              )}

              {items.map((l) => (
                <PipelineCard
                  key={l.id}
                  listing={l}
                  followed={followedCompanies.has(l.company.toLowerCase())}
                />
              ))}

              {total > items.length && (
                <p className="text-center text-[11px] font-medium text-faint">
                  Showing latest {items.length} of {total} —{" "}
                  <Link href={`/?status=${col.status}`} className="font-semibold text-teal-ink underline">
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
