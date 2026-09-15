import { listPinnedCountries, q, rowToListing } from "@/db";
import { isBangladeshRelevant } from "@/lib/bd";
import { getGlobalKeywords } from "@/lib/settings";
import type { FilterableListing } from "@/lib/types";
import { buildJobView, PAGE_SIZE } from "@/lib/job-view";
import { FilterBar } from "@/components/FilterBar";
import { ListingCard } from "@/components/ListingCard";
import { FacetSidebar } from "@/components/FacetSidebar";
import { Pagination } from "@/components/Pagination";
import { ArrowUpRight, BriefcaseBusiness, MapPin } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

// May kick a self-heal refresh on a cold instance while the remote is down.
export const maxDuration = 60;

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
  const [globalKeywords, rows] = await Promise.all([
    getGlobalKeywords(),
    q<Record<string, unknown>>(
      `select l.*, b.name as board_name, b.filter_keywords as board_filter_keywords
       from listings l join boards b on b.id = l.board_id
       order by coalesce(l.posted_at, l.fetched_at) desc`,
    ),
  ]);

  const pool = (
    rows.map((r) => rowToListing(r as never)) as FilterableListing[]
  ).filter(isBangladeshRelevant);

  const view = buildJobView(pool, sp, globalKeywords);

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-3xl border border-teal-200 bg-teal-50 px-5 py-6 sm:px-7 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white/70 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-teal-800">
              <MapPin className="h-3.5 w-3.5" /> Local radar
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-[-0.04em] text-slate-950 sm:text-4xl">Bangladesh opportunities</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-[15px]">
              Jobs in Dhaka, Chattogram, Sylhet, and beyond, plus remote roles that welcome Bangladeshi candidates.
            </p>
          </div>
          <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
            Browse all jobs <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">New matches</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{view.totalNew}</p>
          </div>
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Showing now</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{view.totalVisible}</p>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
        <FacetSidebar facets={view.facets} pinnedCountries={(await listPinnedCountries()).map((n) => n.toLowerCase())} />

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">Local openings</p>
              <p className="mt-1 text-sm text-slate-500">{sp.showAll ? "All Bangladesh-relevant results" : "Matched to your keywords"}</p>
            </div>
            <p className="text-xs font-medium text-slate-400">Page {view.currentPage} of {view.totalPages}</p>
          </div>

          <FilterBar />

          {view.entries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center shadow-sm sm:px-10">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-600">
                <BriefcaseBusiness className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-base font-bold text-slate-900">No local matches right now</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                New roles appear as your connected boards refresh. Try clearing a filter or check back soon.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                {view.entries.map(({ listing, matched }) => (
                  <ListingCard key={listing.id} listing={listing} matched={matched} />
                ))}
              </div>
              <p className="text-center text-xs font-medium text-slate-400">
                Showing {(view.currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(view.currentPage * PAGE_SIZE, view.totalVisible)} of {view.totalVisible}
              </p>
              <Pagination currentPage={view.currentPage} totalPages={view.totalPages} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
