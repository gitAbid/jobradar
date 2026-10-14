import Link from "next/link";
import { ListingCard } from "@/components/ListingCard";
import { Pagination } from "@/components/Pagination";
import { RefreshButton } from "@/components/RefreshButton";
import { EmptyState } from "@/components/ui";
import { hasActiveFilters } from "@/lib/empty-state";
import { PAGE_SIZE, type JobView } from "@/lib/job-view";

const secondaryLink =
  "inline-flex min-h-11 items-center rounded-lg border border-border-strong bg-surface-raised px-4 text-sm font-semibold text-foreground hover:bg-surface";

/** Listing grid + empty states + pagination for the dashboard. */
export function JobFeed({
  view,
  searchParams,
  followedCompanies,
  isAdmin = false,
}: {
  view: JobView;
  searchParams: Parameters<typeof hasActiveFilters>[0];
  followedCompanies: Set<string>;
  /** only admins can refresh or add boards */
  isAdmin?: boolean;
}) {
  if (view.entries.length === 0) {
    return hasActiveFilters(searchParams) ? (
      <EmptyState
        variant="filtered"
        title="No openings match these filters"
        description="Your filters are narrower than the data. Loosen or clear them to see more."
        clearFilters={
          <Link href="/" className={secondaryLink}>
            Clear filters
          </Link>
        }
      />
    ) : isAdmin ? (
      <EmptyState
        title="No matches just yet"
        description="Refresh your boards for the latest openings, or add a new source if you want to widen the radar."
        action={
          <>
            <RefreshButton />
            <Link href="/admin/boards" className={secondaryLink}>
              Add a board
            </Link>
          </>
        }
      />
    ) : (
      <EmptyState
        title="No matches just yet"
        description="New openings are gathered regularly. Check back soon."
      />
    );
  }

  return (
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
  );
}
