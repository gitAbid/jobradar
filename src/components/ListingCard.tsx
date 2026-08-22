import { Heart, Send, Eye, ExternalLink, MapPin, Building2, Globe, Plane, Star } from "lucide-react";
import Link from "next/link";
import { setListingStatusAction, toggleFollowCompanyAction } from "@/app/actions";
import type { FilterableListing } from "@/lib/types";

/** Skill chip → clicking filters the dashboard to that skill. */
function SkillChip({ skill }: { skill: string }) {
  return (
    <Link
      href={`/?q=${encodeURIComponent(skill)}`}
      className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-100"
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
          <mark key={i} className="rounded bg-amber-200 px-0.5">
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
        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition ${
          active
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
        }`}
      >
        {children}
      </button>
    </form>
  );
}

/** Follow/unfollow toggle for the listing's company (server action form). */
function FollowCompanyButton({
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
        className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] transition ${
          followed
            ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
            : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        }`}
      >
        <Star className={`h-3 w-3 ${followed ? "fill-current" : ""}`} />
        {followed ? "Following" : "Follow"}
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
  const isFollowed = followedCompanies?.has(listing.company.toLowerCase()) ?? false;

  return (
    <article className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={listing.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:underline"
            >
              <Highlight text={listing.title} keywords={matched} />
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            </a>
            {listing.isRemote && listing.remoteScope === "anywhere" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800">
                <Globe className="h-3.5 w-3.5" /> Remote · Anywhere
              </span>
            )}
            {listing.isRemote && listing.remoteScope === "restricted" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">
                <MapPin className="h-3.5 w-3.5" /> Remote · Select countries
              </span>
            )}
            {listing.visaSponsorship && (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sky-800">
                <Plane className="h-3.5 w-3.5" /> Visa Sponsorship
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {listing.company || "—"}
            </span>
            {listing.company && (
              <FollowCompanyButton company={listing.company} followed={isFollowed} />
            )}
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {listing.location || "—"}
            </span>
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5">{listing.boardName}</span>
            {posted && <span title={listing.postedAt ?? ""}>{posted}</span>}
          </div>
        </div>
      </div>

      {(listing.skills.length > 0 || listing.tags.length > 0 || listing.userTags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1">
          {listing.skills.slice(0, 10).map((s) => (
            <SkillChip key={s} skill={s} />
          ))}
          {/* raw board tags that aren't already covered by a detected skill */}
          {listing.tags
            .filter((t) => !listing.skills.some((s) => s.toLowerCase() === t.toLowerCase()))
            .slice(0, 6)
            .map((t) => (
              <span key={t} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                <Highlight text={t} keywords={matched} />
              </span>
            ))}
          {listing.userTags.map((t) => (
            <span key={t} className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] text-violet-700">
              #{t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-1.5 pt-1">
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
            className="ml-auto text-xs text-slate-400 hover:text-slate-600"
          >
            manage →
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
