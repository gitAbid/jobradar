import { connection } from "next/server";
import Link from "next/link";
import { listFollowedCompanies, q, rowToListing } from "@/db";
import { toggleFollowCompanyAction } from "@/app/actions";
import { ListingCard } from "@/components/ListingCard";
import { ArrowUpRight, Building2, Heart, Star, X } from "lucide-react";
import type { FilterableListing } from "@/lib/types";

// May kick a self-heal refresh on a cold instance while the remote is down.
export const maxDuration = 60;

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
  const sp = await searchParams;

  const followed = await listFollowedCompanies();
  const selected = sp.company?.trim();
  // only accept a filter that matches a followed company (case-insensitive)
  const activeCompany =
    selected && followed.some((n) => n.toLowerCase() === selected.toLowerCase())
      ? followed.find((n) => n.toLowerCase() === selected.toLowerCase())!
      : null;

  // Openings whose company is followed, newest first.
  // Capped: a prolific company shouldn't produce an unbounded page.
  const rows = followed.length
    ? await q<Record<string, unknown>>(
        `select l.*, b.name as board_name
         from listings l join boards b on b.id = l.board_id
         where exists (
           select 1 from followed_companies fc
           where lower(fc.name) = lower(l.company)
         )
         ${activeCompany ? "and lower(l.company) = lower($1)" : ""}
         order by coalesce(l.posted_at, l.fetched_at) desc
         limit ${FOLLOWING_LIMIT}`,
        activeCompany ? [activeCompany] : [],
      )
    : [];

  const listings = rows.map((r) => rowToListing(r as never)) as FilterableListing[];
  const followedSet = new Set(followed.map((n) => n.toLowerCase()));

  // Accurate per-company opening counts (unaffected by the feed cap above).
  const counts = new Map<string, number>(
    (
      await q<{ company: string; n: number }>(
        `select min(l.company) as company, count(*) as n
         from listings l join followed_companies f on lower(f.name) = lower(l.company)
         group by lower(l.company)`,
      )
    ).map((r) => [r.company.toLowerCase(), r.n]),
  );
  const totalCount = [...counts.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-3xl bg-amber-50 px-5 py-6 sm:px-7 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/70 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800">
              <Star className="h-3.5 w-3.5 fill-current" /> Your shortlist
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-[-0.04em] text-slate-950 sm:text-4xl">Following</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-[15px]">
              Keep an eye on the companies you would be excited to join. New openings collect here automatically.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            Find companies <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Companies</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{followed.length}</p>
          </div>
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Openings</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{totalCount}</p>
          </div>
        </div>
      </section>

      {followed.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-900">Companies you follow</p>
              <p className="mt-0.5 text-xs text-slate-400">Select one to focus your feed.</p>
            </div>
            <Building2 className="h-5 w-5 text-amber-500" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/following"
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                !activeCompany
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:text-amber-800"
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
                      ? "border-amber-400 bg-amber-100 text-amber-900 shadow-sm"
                      : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                  }`}
                >
                  <Link
                    href={`/following?company=${encodeURIComponent(name)}`}
                    title={`Show only ${name} openings`}
                    className="inline-flex min-h-10 items-center gap-1.5 py-1 pl-3 pr-1"
                  >
                    <Star className={`h-3.5 w-3.5 fill-current ${isActive ? "text-amber-600" : "text-amber-500"}`} />
                    {name}
                    <span className={isActive ? "text-amber-700" : "text-amber-600"}>
                      {counts.get(name.toLowerCase()) ?? 0}
                    </span>
                  </Link>
                  <form action={toggleFollowCompanyAction}>
                    <input type="hidden" name="company" value={name} />
                    <button
                      type="submit"
                      title={`Unfollow ${name}`}
                      aria-label={`Unfollow ${name}`}
                      className={`inline-flex min-h-10 items-center p-2 transition-colors hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-500 ${isActive ? "text-amber-700" : "text-amber-400"}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </form>
                </span>
              );
            })}
          </div>
        </section>
      )}

      {followed.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center shadow-sm sm:px-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <Heart className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-base font-bold text-slate-900">Build your company shortlist</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            Tap the star next to any company on a job card and its current openings will appear here.
          </p>
          <Link href="/" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">
            Explore the dashboard <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      ) : listings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center shadow-sm sm:px-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <Building2 className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-base font-bold text-slate-900">No current openings</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            No current openings from <strong>{activeCompany}</strong>.
          </p>
          <p className="mt-3 text-sm text-slate-500">
            <Link href="/following" className="font-semibold text-teal-700 underline">View all followed companies</Link> or check the <Link href="/" className="font-semibold text-teal-700 underline">Dashboard</Link> after a refresh.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {activeCompany && (
            <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-900">
              Showing openings from <strong>{activeCompany}</strong> only. <Link href="/following" className="font-bold underline">Show all</Link>
            </p>
          )}
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} matched={[]} followedCompanies={followedSet} />
          ))}
          {!activeCompany && listings.length >= FOLLOWING_LIMIT && (
            <p className="text-center text-xs font-medium text-slate-400">Showing the latest {FOLLOWING_LIMIT} openings.</p>
          )}
        </div>
      )}
    </div>
  );
}
