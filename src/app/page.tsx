import { getDb, rowToListing } from "@/db";
import { getGlobalKeywords, isSoundEnabled } from "@/lib/settings";
import { matchedKeywords, matchesKeywords } from "@/lib/filters";
import type { FilterableListing } from "@/lib/types";
import { FilterBar } from "@/components/FilterBar";
import { ListingCard } from "@/components/ListingCard";
import { RefreshButton } from "@/components/RefreshButton";
import { SkillSidebar } from "@/components/SkillSidebar";
import { Pagination } from "@/components/Pagination";
import { connection } from "next/server";

const PAGE_SIZE = 20;

interface SearchParams {
  q?: string;
  status?: string;
  board?: string;
  remote?: string;
  visa?: string;
  showAll?: string;
  skill?: string | string[];
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

  // ── Skill facets (counts over all non-hidden listings) ────────────────
  const facetCounts = new Map<string, number>();
  for (const l of listings) {
    if (l.status === "hidden") continue;
    for (const s of l.skills) facetCounts.set(s, (facetCounts.get(s) ?? 0) + 1);
  }
  const skillFacets = [...facetCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  const totalNew = listings.filter((l) => l.status === "new").length;

  // ── Structured filters (SQL would work too; JS keeps highlighting consistent)
  if (sp.status) listings = listings.filter((l) => l.status === sp.status);
  else listings = listings.filter((l) => l.status !== "hidden");

  if (sp.board) {
    const boardId = Number(sp.board);
    listings = listings.filter((l) => l.boardId === boardId);
  }
  if (sp.remote === "1") listings = listings.filter((l) => l.isRemote);
  else if (sp.remote === "anywhere")
    listings = listings.filter((l) => l.isRemote && l.remoteScope === "anywhere");
  else if (sp.remote === "restricted")
    listings = listings.filter((l) => l.isRemote && l.remoteScope === "restricted");
  if (sp.visa === "1") listings = listings.filter((l) => l.visaSponsorship);

  // ── Skill facet filter (OR: any selected skill) ────────────────────────
  const selectedSkills = sp.skill
    ? Array.isArray(sp.skill)
      ? sp.skill
      : [sp.skill]
    : [];
  if (selectedSkills.length > 0) {
    listings = listings.filter((l) =>
      selectedSkills.some((s) => l.skills.includes(s)),
    );
    // keep selected skills visible/checkable in the sidebar even when
    // they fall outside the top-25 facet cut
    for (const s of selectedSkills) {
      if (!skillFacets.some((f) => f.name === s)) {
        skillFacets.push({ name: s, count: facetCounts.get(s) ?? 0 });
      }
    }
  }

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

  const boards = (
    db.prepare("SELECT id, name FROM boards ORDER BY name").all() as {
      id: number;
      name: string;
    }[]
  ).map((b) => ({ id: b.id, name: b.name }));

  return (
    <div className="flex gap-6">
      <SkillSidebar skills={skillFacets} />

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Dashboard</h1>
            <p className="text-sm text-slate-500">
              {totalNew} new · {totalVisible} shown
              {selectedSkills.length > 0 && ` · skills: ${selectedSkills.join(", ")}`}
              {!showAll && " (matching your keywords — toggle “Show all” to see everything)"}
            </p>
          </div>
          <RefreshButton soundEnabled={isSoundEnabled()} />
        </div>

        <FilterBar boards={boards} />

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
