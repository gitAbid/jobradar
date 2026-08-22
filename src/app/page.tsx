import { getDb, rowToListing } from "@/db";
import { getGlobalKeywords, isSoundEnabled } from "@/lib/settings";
import type { FilterableListing } from "@/lib/types";
import { buildJobView, PAGE_SIZE } from "@/lib/job-view";
import { FilterBar } from "@/components/FilterBar";
import { ListingCard } from "@/components/ListingCard";
import { RefreshButton } from "@/components/RefreshButton";
import { FacetSidebar } from "@/components/FacetSidebar";
import { Pagination } from "@/components/Pagination";
import { connection } from "next/server";

interface SearchParams {
  q?: string;
  status?: string;
  remote?: string;
  visa?: string;
  showAll?: string;
  skill?: string | string[];
  country?: string | string[];
  company?: string | string[];
  source?: string | string[];
  page?: string;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await connection(); // always render at request time (DB reads must not be prerendered)
  const sp = await searchParams;
  const db = getDb();
  const globalKeywords = getGlobalKeywords();

  const rows = db
    .prepare(
      `SELECT l.*, b.name AS board_name, b.filter_keywords AS board_filter_keywords
       FROM listings l JOIN boards b ON b.id = l.board_id
       ORDER BY COALESCE(l.posted_at, l.fetched_at) DESC`,
    )
    .all() as Record<string, unknown>[];

  const pool = rows.map((r) => rowToListing(r as never)) as FilterableListing[];
  const view = buildJobView(pool, sp, globalKeywords);

  return (
    <div className="flex gap-6">
      <FacetSidebar facets={view.facets} />

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Dashboard</h1>
            <p className="text-sm text-slate-500">
              {view.totalNew} new · {view.totalVisible} shown
              {view.selections.skill.length > 0 && ` · skills: ${view.selections.skill.join(", ")}`}
              {view.selections.country.length > 0 && ` · countries: ${view.selections.country.join(", ")}`}
              {!sp.showAll && " (matching your keywords — toggle “Show all” to see everything)"}
            </p>
          </div>
          <RefreshButton soundEnabled={isSoundEnabled()} />
        </div>

        <FilterBar />

        {view.entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
            No listings yet. Hit <strong>Refresh now</strong> to pull from your boards,
            or add more boards on the <a href="/boards" className="underline">Boards</a> page.
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {view.entries.map(({ listing, matched }) => (
                <ListingCard key={listing.id} listing={listing} matched={matched} />
              ))}
            </div>
            <p className="text-center text-xs text-slate-400">
              Showing {(view.currentPage - 1) * PAGE_SIZE + 1}–
              {Math.min(view.currentPage * PAGE_SIZE, view.totalVisible)} of{" "}
              {view.totalVisible}
            </p>
            <Pagination currentPage={view.currentPage} totalPages={view.totalPages} />
          </>
        )}
      </div>
    </div>
  );
}
