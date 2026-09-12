import { Heart, Send, Eye, ExternalLink, MapPin, Building2, Globe, Plane, Star, ChevronDown } from "lucide-react";
import Link from "next/link";
import { setListingStatusAction, toggleFollowCompanyAction } from "@/app/actions";
import { freshnessOf, type FreshnessTier } from "@/lib/freshness";
import type { FilterableListing } from "@/lib/types";

/**
 * Freshness → presentation. Only urgent/young tiers get any treatment, and it
 * is limited to a soft left edge + faint tint (card) and a small pill (badge),
 * so the quiet majority of cards are untouched and text contrast is unchanged.
 */
const CARD_ACCENT: Record<FreshnessTier, string> = {
  fresh: "border-l-[3px] border-l-emerald-400/70 bg-emerald-50/40 hover:border-l-emerald-300",
  closing: "border-l-[3px] border-l-amber-400/70 bg-amber-50/40 hover:border-l-amber-300",
  expired: "border-l-[3px] border-l-slate-300/70",
  recent: "",
  aging: "",
  unknown: "",
};

const BADGE_STYLE: Record<FreshnessTier, string> = {
  fresh: "border-emerald-200 bg-emerald-50 text-emerald-700",
  closing: "border-amber-200 bg-amber-50 text-amber-800",
  expired: "border-slate-200 bg-slate-100 text-slate-500",
  recent: "",
  aging: "",
  unknown: "",
};

const BADGE_DOT: Record<FreshnessTier, string> = {
  fresh: "bg-emerald-500",
  closing: "bg-amber-500",
  expired: "bg-slate-400",
  recent: "",
  aging: "",
  unknown: "",
};

/** Skill chip → clicking filters the dashboard to that skill. */
function SkillChip({ skill }: { skill: string }) {
  return (
    <Link
      href={`/?q=${encodeURIComponent(skill)}`}
      className="rounded-lg border border-teal-100 bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-700 transition-colors hover:border-teal-200 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      title={`Show ${skill} jobs`}
    >
      {skill}
    </Link>
  );
}

function Highlight({ text, keywords }: { text: string; keywords: string[] }) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const hits = keywords.filter((k) => lower.includes(k));
  if (hits.length === 0) return <>{text}</>;
  // split on any keyword occurrence
  const re = new RegExp(
    `(${hits.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return (
    <>
      {text.split(re).map((part, i) =>
        hits.includes(part.toLowerCase()) ? (
          <mark key={i} className="rounded bg-amber-200 px-0.5 text-amber-950">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function StatusButton({
  id,
  status,
  active,
  children,
  title,
}: {
  id: number;
  status: string;
  active: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <form action={setListingStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        title={title}
        className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
          active
            ? "border-slate-900 bg-slate-900 text-white shadow-sm"
            : "border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800"
        }`}
      >
        {children}
      </button>
    </form>
  );
}

/** Company badge with integrated follow toggle — click to follow/unfollow. */
export function CompanyBadge({
  company,
  followed,
}: {
  company: string;
  followed: boolean;
}) {
  return (
    <form action={toggleFollowCompanyAction} className="inline">
      <input type="hidden" name="company" value={company} />
      <button
        type="submit"
        title={followed ? `Unfollow ${company}` : `Follow ${company} for new openings`}
        className={`inline-flex min-h-9 max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
          followed
            ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
            : "border-slate-200 bg-slate-50 text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
        }`}
      >
        <Building2 className="h-3 w-3 shrink-0" />
        <span className="truncate">{company}</span>
        <Star className={`h-3 w-3 shrink-0 ${followed ? "fill-current text-amber-500" : "opacity-40"}`} />
      </button>
    </form>
  );
}

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
            {freshness.label && (
              <span
                title={
                  freshness.tier === "expired"
                    ? `Deadline was ${listing.deadline ? new Date(listing.deadline).toLocaleDateString() : "unspecified"}`
                    : freshness.tier === "closing"
                      ? `Deadline ${listing.deadline ? new Date(listing.deadline).toLocaleDateString() : ""}`
                      : `Posted ${listing.postedAt ? new Date(listing.postedAt).toLocaleDateString() : ""}`
                }
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${BADGE_STYLE[freshness.tier]}`}
              >
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${BADGE_DOT[freshness.tier]}`} />
                {freshness.label}
              </span>
            )}
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
            <SkillChip key={s} skill={s} />
          ))}
          {/* raw board tags that aren't already covered by a detected skill */}
          {listing.tags
            .filter((t) => !listing.skills.some((s) => s.toLowerCase() === t.toLowerCase()))
            .slice(0, 6)
            .map((t) => (
              <span key={t} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                <Highlight text={t} keywords={matched} />
              </span>
            ))}
          {listing.userTags.map((t) => (
            <span key={t} className="rounded-lg border border-violet-100 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700">
              #{t}
            </span>
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
        <StatusButton id={listing.id} status="favorite" active={listing.status === "favorite"} title="Favorite">
          <Heart className="h-3.5 w-3.5" /> Favorite
        </StatusButton>
        <StatusButton id={listing.id} status="applied" active={listing.status === "applied"} title="Mark applied">
          <Send className="h-3.5 w-3.5" /> Applied
        </StatusButton>
        <StatusButton id={listing.id} status="hidden" active={false} title="Hide this listing">
          <Eye className="h-3.5 w-3.5" /> Hide
        </StatusButton>
        {listing.status === "favorite" || listing.status === "applied" ? (
          <Link
            href="/applied"
            className="ml-auto inline-flex min-h-10 items-center rounded-lg px-2 text-xs font-semibold text-slate-400 transition-colors hover:bg-slate-50 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            Manage saved jobs <span aria-hidden="true" className="ml-1">→</span>
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days > 30) return `${Math.floor(days / 30)}mo ago`;
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  return "just now";
}
