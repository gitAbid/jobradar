import { getDb, rowToListing, listPinnedCountries } from "@/db";
import { isBangladeshRelevant } from "@/lib/bd";
import { getGlobalKeywords } from "@/lib/settings";
import type { FilterableListing } from "@/lib/types";
import { buildJobView, PAGE_SIZE } from "@/lib/job-view";
import { FilterBar } from "@/components/FilterBar";
import { ListingCard } from "@/components/ListingCard";
import { FacetSidebar } from "@/components/FacetSidebar";
import { Pagination } from "@/components/Pagination";
import { MapPin } from "lucide-react";
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

export default async function BangladeshPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await connection(); // request-time rendering
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

  const pool = (
    rows.map((r) => rowToListing(r as never)) as FilterableListing[]
  ).filter(isBangladeshRelevant);

  const view = buildJobView(pool, sp, globalKeywords);

  return (
    <div className="flex gap-6">
      <FacetSidebar facets={view.facets} pinnedCountries={listPinnedCountries(db).map((n) => n.toLowerCase())} />

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <MapPin className="h-5 w-5 text-emerald-600" /> Bangladesh
          </h1>
          <p className="text-sm text-slate-500">
            Jobs located in Bangladesh (Dhaka, Chattogram, Sylhet…) plus remote roles that accept
            Bangladeshi candidates. {view.totalNew} new · {view.totalVisible} shown
            {!sp.showAll && " — toggle “Show all” to include non-keyword matches"}
          </p>
        </div>

        <FilterBar />

        {view.entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
            No Bangladesh-relevant listings right now. New ones appear automatically as your
            boards refresh — BDJobs IT is connected; more local sources coming.
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
