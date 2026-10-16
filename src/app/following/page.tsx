import { connection } from "next/server";
import { requirePageUser } from "@/lib/authz";
import Link from "next/link";
import { LISTING_POOL_SELECT, q, rowToListing, USER_STATE_SELECT, userStateJoin } from "@/db";
import { getUserContext } from "@/lib/user-context";
import { UnfollowButton } from "@/components/UnfollowButton";
import { ListingCard } from "@/components/ListingCard";
import { EmptyState } from "@/components/ui";
import { ArrowUpRight, Building2, Star } from "lucide-react";
import type { FilterableListing } from "@/lib/types";

export const metadata = { title: "Following" };

const FOLLOWING_LIMIT = 200;

interface SearchParams {
  company?: string;
}

export default async function FollowingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await connection(); // request-time rendering
  const user = await requirePageUser();
  // Accurate per-company opening counts (unaffected by the feed cap below);
  // depends only on the user, so it runs alongside everything else.
  const countsQuery = q<{ company: string; n: number }>(
    `select min(l.company) as company, count(*) as n
     from listings l join followed_companies f on lower(f.name) = lower(l.company)
     where f.user_id = $1::uuid
     group by lower(l.company)`,
    [user.id],
  );
  countsQuery.catch(() => {}); // still awaited below; just never an unhandled rejection
  const [sp, ctx] = await Promise.all([searchParams, getUserContext(user.id)]);

  const followed = ctx.followedCompanies;
  const selected = sp.company?.trim();
  // only accept a filter that matches a followed company (case-insensitive)
  const activeCompany =
    selected && followed.some((n) => n.toLowerCase() === selected.toLowerCase())
      ? followed.find((n) => n.toLowerCase() === selected.toLowerCase())!
      : null;

  // Openings whose company is followed, newest first (description inline: the
  // page shows all of them). Capped: a prolific company shouldn't produce an
  // unbounded page.
  const rowsQuery = followed.length
    ? q<Record<string, unknown>>(
        `select ${LISTING_POOL_SELECT}, l.description, ${USER_STATE_SELECT}, b.name as board_name
         from listings l join boards b on b.id = l.board_id
         ${userStateJoin("$1")}
         where exists (
           select 1 from followed_companies fc
           where fc.user_id = $1::uuid and lower(fc.name) = lower(l.company)
         )
         ${activeCompany ? "and lower(l.company) = lower($2)" : ""}
         order by coalesce(l.posted_at, l.fetched_at) desc
         limit ${FOLLOWING_LIMIT}`,
        activeCompany ? [user.id, activeCompany] : [user.id],
      )
    : Promise.resolve([]);

  const [rows, countRows] = await Promise.all([rowsQuery, countsQuery]);
  const listings = rows.map((r) => rowToListing(r as never)) as FilterableListing[];
  const followedSet = new Set(followed.map((n) => n.toLowerCase()));
  const counts = new Map<string, number>(countRows.map((r) => [r.company.toLowerCase(), r.n]));
  const totalCount = [...counts.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-3xl bg-amber-soft px-5 py-6 sm:px-7 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-line bg-surface-raised/70 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-ink">
              <Star className="h-3.5 w-3.5 fill-current" /> Your shortlist
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-[-0.04em] text-foreground sm:text-4xl">Following</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted sm:text-[15px]">
              Keep an eye on the companies you would be excited to join. New openings collect here automatically.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            Find companies <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <div className="rounded-2xl bg-surface-raised px-4 py-3 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Companies</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{followed.length}</p>
          </div>
          <div className="rounded-2xl bg-surface-raised px-4 py-3 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Openings</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{totalCount}</p>
          </div>
        </div>
      </section>

      {followed.length > 0 && (
        <section className="rounded-2xl border border-border bg-surface-raised p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-foreground">Companies you follow</p>
              <p className="mt-0.5 text-xs text-faint">Select one to focus your feed.</p>
            </div>
            <Building2 className="h-5 w-5 text-amber-500" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/following"
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                !activeCompany
                  ? "border-ink bg-ink text-white"
                  : "border-border bg-surface-raised text-muted hover:border-amber-line hover:text-amber-ink"
              }`}
            >
              All <span className="opacity-70">{totalCount}</span>
            </Link>

            {followed.map((name) => {
              const isActive = activeCompany?.toLowerCase() === name.toLowerCase();
              return (
                <span
                  key={name}
                  className={`inline-flex min-h-10 items-center overflow-hidden rounded-xl border text-xs font-semibold transition-colors ${
                    isActive
                      ? "border-amber-line bg-amber-soft2 text-amber-ink shadow-sm"
                      : "border-amber-line bg-amber-soft text-amber-ink hover:bg-amber-soft2"
                  }`}
                >
                  <Link
                    href={`/following?company=${encodeURIComponent(name)}`}
                    title={`Show only ${name} openings`}
                    className="inline-flex min-h-10 items-center gap-1.5 py-1 pl-3 pr-1"
                  >
                    <Star className={`h-3.5 w-3.5 fill-current ${isActive ? "text-amber-ink" : "text-amber-500"}`} />
                    {name}
                    <span className={isActive ? "text-amber-ink" : "text-amber-ink"}>
                      {counts.get(name.toLowerCase()) ?? 0}
                    </span>
                  </Link>
                  <UnfollowButton
                    name={name}
                    className={`inline-flex min-h-10 items-center p-2 transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-500 ${isActive ? "text-amber-ink" : "text-amber-400"}`}
                  />
                </span>
              );
            })}
          </div>
        </section>
      )}

      {followed.length === 0 ? (
        <EmptyState
          title="Build your company shortlist"
          description="Tap the star next to any company on a job card and its current openings will appear here."
          action={
            <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">
              Browse jobs <ArrowUpRight className="h-4 w-4" />
            </Link>
          }
        />
      ) : listings.length === 0 ? (
        <EmptyState
          variant="filtered"
          title="No current openings"
          description={<>No current openings from <strong>{activeCompany}</strong>.</>}
          clearFilters={
            <Link href="/following" className="inline-flex min-h-11 items-center rounded-lg border border-border-strong bg-surface-raised px-4 text-sm font-semibold text-foreground hover:bg-surface">
              View all followed companies
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <h2 className="sr-only">Openings from followed companies</h2>
          {activeCompany && (
            <p className="rounded-xl bg-amber-soft px-3.5 py-2.5 text-xs font-medium text-amber-ink">
              Showing openings from <strong>{activeCompany}</strong> only. <Link href="/following" className="font-bold underline">Show all</Link>
            </p>
          )}
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} matched={[]} followedCompanies={followedSet} />
          ))}
          {!activeCompany && listings.length >= FOLLOWING_LIMIT && (
            <p className="text-center text-xs font-medium text-faint">Showing the latest {FOLLOWING_LIMIT} openings.</p>
          )}
        </div>
      )}
    </div>
  );
}
