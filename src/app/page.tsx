import { getDb, rowToListing, listFollowedCompanies, listPinnedCountries } from "@/db";
import { getGlobalKeywords, isSoundEnabled } from "@/lib/settings";
import type { FilterableListing } from "@/lib/types";
import { buildJobView, PAGE_SIZE } from "@/lib/job-view";
import { FilterBar } from "@/components/FilterBar";
import { ListingCard } from "@/components/ListingCard";
import { RefreshButton } from "@/components/RefreshButton";
import { FacetSidebar } from "@/components/FacetSidebar";
import { Pagination } from "@/components/Pagination";
import { connection } from "next/server";
import { ArrowUpRight, BriefcaseBusiness, Sparkles } from "lucide-react";
import Link from "next/link";

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
  const followedCompanies = new Set(listFollowedCompanies(db).map((n) => n.toLowerCase()));
  const pinnedCountries = listPinnedCountries(db).map((n) => n.toLowerCase());

  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-3xl bg-slate-900 px-5 py-6 text-white shadow-[0_18px_45px_rgb(15_42_67/0.14)] sm:px-7 sm:py-8">
        <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full border-[24px] border-teal-400/15" />
        <div className="pointer-events-none absolute -bottom-24 right-24 h-48 w-48 rounded-full border-[20px] border-coral-500/10" />
        <div className="relative flex flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-teal-300/25 bg-teal-300/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-teal-200">
                <Sparkles className="h-3.5 w-3.5" /> Live job radar
              </div>
              <h1 className="max-w-xl text-3xl font-bold tracking-[-0.04em] text-white sm:text-4xl">
                Find your next move.
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-[15px]">
                Your boards are gathered here, ranked by the skills and places you care about.
                Scan the newest matches, save the promising ones, and keep moving.
              </p>
            </div>
            <RefreshButton soundEnabled={isSoundEnabled()} />
          </div>

          <div className="flex flex-wrap gap-2.5">
            <div className="min-w-32 rounded-2xl border border-white/10 bg-white/10 px-3.5 py-3 backdrop-blur-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">New matches</p>
              <p className="mt-1 text-2xl font-bold tracking-tight text-white">{view.totalNew}</p>
            </div>
            <div className="min-w-32 rounded-2xl border border-white/10 bg-white/10 px-3.5 py-3 backdrop-blur-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Showing now</p>
              <p className="mt-1 text-2xl font-bold tracking-tight text-white">{view.totalVisible}</p>
            </div>
            <Link
              href="/boards"
              className="group inline-flex min-h-[4.5rem] flex-1 items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-3.5 py-3 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 sm:max-w-xs"
            >
              <span className="flex items-center gap-2.5">
                <BriefcaseBusiness className="h-4 w-4 text-coral-300" />
                <span>
                  <span className="block font-semibold text-white">Manage your boards</span>
                  <span className="mt-0.5 block text-xs text-slate-400">Tune sources and keywords</span>
                </span>
              </span>
              <ArrowUpRight className="h-4 w-4 text-slate-500 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
        <FacetSidebar facets={view.facets} pinnedCountries={pinnedCountries} />

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">Latest openings</p>
              <p className="mt-1 text-sm text-slate-500">
                {view.selections.skill.length > 0 && `Skills: ${view.selections.skill.join(", ")} · `}
                {view.selections.country.length > 0 && `Countries: ${view.selections.country.join(", ")} · `}
                {sp.showAll ? "All board results" : "Matched to your keywords"}
              </p>
            </div>
            <p className="text-xs font-medium text-slate-400">Page {view.currentPage} of {view.totalPages}</p>
          </div>

          <FilterBar />

          {view.entries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center shadow-sm sm:px-10">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-600">
                <BriefcaseBusiness className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-base font-bold text-slate-900">No matches just yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                Refresh your boards for the latest openings, or add a new source if you want to widen the radar.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <RefreshButton soundEnabled={isSoundEnabled()} />
                <Link href="/boards" className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:border-teal-300 hover:text-teal-800">
                  Add a board
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                {view.entries.map(({ listing, matched }) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    matched={matched}
                    followedCompanies={followedCompanies}
                  />
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
