import { getDb, rowToListing } from "@/db";
import { getGlobalKeywords, isSoundEnabled } from "@/lib/settings";
import { matchedKeywords, matchesKeywords } from "@/lib/filters";
import {
  computeFacet,
  countryFacetValue,
  selectedParam,
  topValues,
} from "@/lib/facets";
import type { FilterableListing } from "@/lib/types";
import { FilterBar } from "@/components/FilterBar";
import { ListingCard } from "@/components/ListingCard";
import { RefreshButton } from "@/components/RefreshButton";
import { FacetSidebar } from "@/components/FacetSidebar";
import { Pagination } from "@/components/Pagination";
import { connection } from "next/server";

const PAGE_SIZE = 20;

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

  // ── Load listings joined with board info ──────────────────────────────
  const rows = db
    .prepare(
      `SELECT l.*, b.name AS board_name, b.filter_keywords AS board_filter_keywords
       FROM listings l JOIN boards b ON b.id = l.board_id
       ORDER BY COALESCE(l.posted_at, l.fetched_at) DESC`,
    )
    .all() as Record<string, unknown>[];

  let listings = rows.map((r) => rowToListing(r as never)) as FilterableListing[];

  // ── Facets (counts over all non-hidden listings) ───────────────────────
  const visiblePool = listings.filter((l) => l.status !== "hidden");
  // skills: a listing contributes each of its skills
  const skillFacetCounts = new Map<string, number>();
  for (const l of visiblePool)
    for (const s of l.skills) skillFacetCounts.set(s, (skillFacetCounts.get(s) ?? 0) + 1);
  const countryFacetCounts = computeFacet(visiblePool, countryFacetValue);
  const companyFacetCounts = computeFacet(visiblePool, (l) => l.company || null);
  const sourceFacetCounts = computeFacet(visiblePool, (l) => l.boardName);

  const totalNew = listings.filter((l) => l.status === "new").length;

  // ── Structured filters ────────────────────────────────────────────────
  if (sp.status) listings = listings.filter((l) => l.status === sp.status);
  else listings = listings.filter((l) => l.status !== "hidden");

  if (sp.remote === "1") listings = listings.filter((l) => l.isRemote);
  else if (sp.remote === "anywhere")
    listings = listings.filter((l) => l.isRemote && l.remoteScope === "anywhere");
  else if (sp.remote === "restricted")
    listings = listings.filter((l) => l.isRemote && l.remoteScope === "restricted");
  if (sp.visa === "1") listings = listings.filter((l) => l.visaSponsorship);

  // ── Facet filters ──────────────────────────────────────────────────────
  const selectedSkills = selectedParam(sp.skill);
  if (selectedSkills.length > 0)
    listings = listings.filter((l) => selectedSkills.some((s) => l.skills.includes(s)));

  const selectedCountries = selectedParam(sp.country);
  if (selectedCountries.length > 0)
    listings = listings.filter((l) =>
      selectedCountries.includes(countryFacetValue(l)),
    );

  const selectedCompanies = selectedParam(sp.company);
  if (selectedCompanies.length > 0)
    listings = listings.filter((l) => selectedCompanies.includes(l.company));

  const selectedSources = selectedParam(sp.source);
  if (selectedSources.length > 0)
    listings = listings.filter((l) => selectedSources.includes(l.boardName));

  // ── Assemble sidebar facets ────────────────────────────────────────────
  const facets: Array<{ title: string; param: string; values: { name: string; count: number }[] }> = [
    { title: "Skills", param: "skill", values: topValues(skillFacetCounts, 25) },
    { title: "Country", param: "country", values: topValues(countryFacetCounts, 20) },
    { title: "Company", param: "company", values: topValues(companyFacetCounts, 25) },
    { title: "Source", param: "source", values: topValues(sourceFacetCounts, 25) },
  ];
  // keep any selected value visible even when outside the top cut
  const ensureSelected = (
    param: string,
    sel: string[],
    counts: Map<string, number>,
  ) => {
    const section = facets.find((f) => f.param === param);
    if (!section) return;
    for (const s of sel)
      if (!section.values.some((v) => v.name === s))
        section.values.push({ name: s, count: counts.get(s) ?? 0 });
  };
  ensureSelected("skill", selectedSkills, skillFacetCounts);
  ensureSelected("country", selectedCountries, countryFacetCounts);
  ensureSelected("company", selectedCompanies, companyFacetCounts);
  ensureSelected("source", selectedSources, sourceFacetCounts);

  // ── Keyword filters ────────────────────────────────────────────────────
  const showAll = sp.showAll === "1";
  const keywordMatched = listings.map((l) => ({
    listing: l,
    matched: matchedKeywords(l, globalKeywords),
    isMatch: matchesKeywords(l, globalKeywords),
  }));

  let visible = showAll
    ? keywordMatched
    : keywordMatched.filter((entry) => entry.isMatch);

  if (sp.q) {
    const q = sp.q.toLowerCase();
    visible = visible.filter(
      ({ listing }) =>
        listing.title.toLowerCase().includes(q) ||
        listing.company.toLowerCase().includes(q) ||
        listing.location.toLowerCase().includes(q) ||
        listing.tags.some((t) => t.toLowerCase().includes(q)) ||
        listing.skills.some((s) => s.toLowerCase().includes(q)),
    );
  }

  // company boards post the same role once per location — show one card each
  const seenKeys = new Set<string>();
  visible = visible.filter(({ listing }) => {
    const key = `${listing.company}|${listing.title}`.toLowerCase();
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  // ── Pagination ─────────────────────────────────────────────────────────
  const totalVisible = visible.length;
  const totalPages = Math.max(1, Math.ceil(totalVisible / PAGE_SIZE));
  const requestedPage = Number.parseInt(sp.page ?? "1", 10);
  const currentPage = Math.min(
    Math.max(Number.isNaN(requestedPage) ? 1 : requestedPage, 1),
    totalPages,
  );
  visible = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="flex gap-6">
      <FacetSidebar facets={facets} />

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Dashboard</h1>
            <p className="text-sm text-slate-500">
              {totalNew} new · {totalVisible} shown
              {selectedSkills.length > 0 && ` · skills: ${selectedSkills.join(", ")}`}
              {selectedCountries.length > 0 && ` · countries: ${selectedCountries.join(", ")}`}
              {!showAll && " (matching your keywords — toggle “Show all” to see everything)"}
            </p>
          </div>
          <RefreshButton soundEnabled={isSoundEnabled()} />
        </div>

        <FilterBar />

        {visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
            No listings yet. Hit <strong>Refresh now</strong> to pull from your boards,
            or add more boards on the <a href="/boards" className="underline">Boards</a> page.
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {visible.map(({ listing, matched }) => (
                <ListingCard key={listing.id} listing={listing} matched={matched} />
              ))}
            </div>
            <p className="text-center text-xs text-slate-400">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–
              {Math.min(currentPage * PAGE_SIZE, totalVisible)} of {totalVisible}
            </p>
            <Pagination currentPage={currentPage} totalPages={totalPages} />
          </>
        )}
      </div>
    </div>
  );
}
