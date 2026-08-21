import { getDb, rowToListing } from "@/db";
import { getGlobalKeywords, isSoundEnabled } from "@/lib/settings";
import { matchedKeywords, matchesKeywords } from "@/lib/filters";
import type { FilterableListing } from "@/lib/types";
import { FilterBar } from "@/components/FilterBar";
import { ListingCard } from "@/components/ListingCard";
import { RefreshButton } from "@/components/RefreshButton";
import { connection } from "next/server";

interface SearchParams {
  q?: string;
  status?: string;
  board?: string;
  remote?: string;
  visa?: string;
  showAll?: string;
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

  const totalNew = listings.filter((l) => l.status === "new").length;

  // ── Structured filters (SQL would work too; JS keeps highlighting consistent)
  if (sp.status) listings = listings.filter((l) => l.status === sp.status);
  else listings = listings.filter((l) => l.status !== "hidden");

  if (sp.board) {
    const boardId = Number(sp.board);
    listings = listings.filter((l) => l.boardId === boardId);
  }
  if (sp.remote === "1") listings = listings.filter((l) => l.isRemote);
  if (sp.visa === "1") listings = listings.filter((l) => l.visaSponsorship);

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

  const boards = (
    db.prepare("SELECT id, name FROM boards ORDER BY name").all() as {
      id: number;
      name: string;
    }[]
  ).map((b) => ({ id: b.id, name: b.name }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-slate-500">
            {totalNew} new · {visible.length} shown
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
        <div className="flex flex-col gap-3">
          {visible.map(({ listing, matched }) => (
            <ListingCard key={listing.id} listing={listing} matched={matched} />
          ))}
        </div>
      )}
    </div>
  );
}
