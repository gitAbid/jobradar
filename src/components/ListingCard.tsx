import { ExternalLink, MapPin, Globe, Plane, ChevronDown } from "lucide-react";
import { CompanyBadge } from "@/components/CompanyBadge";
import { ListingStatusButtons } from "@/components/ListingStatusButtons";
import { FreshnessBadge, CARD_ACCENT } from "@/components/FreshnessBadge";
import { Highlight } from "@/components/Highlight";
import { TagChip } from "@/components/TagChip";
import { freshnessOf } from "@/lib/freshness";
import { timeAgo } from "@/lib/time";
import type { FilterableListing } from "@/lib/types";

export function ListingCard({
  listing,
  matched,
  followedCompanies,
}: {
  listing: FilterableListing;
  matched: string[];
  followedCompanies?: Set<string>;
}) {
  const posted = listing.postedAt ? timeAgo(listing.postedAt) : null;
  const freshness = freshnessOf(listing);
  const isFollowed = followedCompanies?.has(listing.company.toLowerCase()) ?? false;

  return (
    <article
      className={`group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgb(15_42_67/0.045)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-[0_14px_30px_rgb(15_42_67/0.09)] sm:p-5 ${CARD_ACCENT[freshness.tier]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={listing.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-start gap-1 text-[15px] font-bold leading-snug tracking-[-0.01em] text-slate-950 hover:text-teal-800 sm:text-base"
            >
              <Highlight text={listing.title} keywords={matched} />
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition-colors group-hover:text-teal-500" />
            </a>
            <FreshnessBadge freshness={freshness} postedAt={listing.postedAt} deadline={listing.deadline} />
            {listing.isRemote && listing.remoteScope === "anywhere" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-teal-800">
                <Globe className="h-3.5 w-3.5" /> Remote · Anywhere
              </span>
            )}
            {listing.isRemote && listing.remoteScope === "restricted" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-amber-800">
                <MapPin className="h-3.5 w-3.5" /> Remote · Select countries
              </span>
            )}
            {listing.visaSponsorship && (
                <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-sky-800">
                <Plane className="h-3.5 w-3.5" /> Visa Sponsorship
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
            {listing.company ? (
              <CompanyBadge company={listing.company} followed={isFollowed} />
            ) : (
              <span className="text-slate-400">Company not listed</span>
            )}
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {listing.location || "—"}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-600">{listing.boardName}</span>
            {posted && <span className="font-medium text-slate-400" title={listing.postedAt ?? ""}>{posted}</span>}
          </div>
        </div>
      </div>

      {(listing.skills.length > 0 || listing.tags.length > 0 || listing.userTags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {listing.skills.slice(0, 10).map((s) => (
            <TagChip key={s} variant="skill" href={`/?q=${encodeURIComponent(s)}`} title={`Show ${s} jobs`}>
              {s}
            </TagChip>
          ))}
          {/* raw board tags that aren't already covered by a detected skill */}
          {listing.tags
            .filter((t) => !listing.skills.some((s) => s.toLowerCase() === t.toLowerCase()))
            .slice(0, 6)
            .map((t) => (
              <TagChip key={t} variant="board">
                <Highlight text={t} keywords={matched} />
              </TagChip>
            ))}
          {listing.userTags.map((t) => (
            <TagChip key={t} variant="user">
              #{t}
            </TagChip>
          ))}
        </div>
      )}

      {listing.description && (
        <details className="group/desc rounded-xl border border-slate-200 bg-slate-50/60">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
            <ChevronDown className="h-4 w-4 transition-transform group-open/desc:rotate-180" />
            Description
          </summary>
          <div className="max-h-96 overflow-y-auto whitespace-pre-line px-3 pb-3 text-[13px] leading-relaxed text-slate-700">
            <Highlight text={listing.description} keywords={matched} />
          </div>
        </details>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <ListingStatusButtons id={listing.id} status={listing.status} />
      </div>
    </article>
  );
}
