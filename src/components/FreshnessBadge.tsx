import { type FreshnessInfo, type FreshnessTier } from "@/lib/freshness";

/**
 * Freshness → presentation. Only urgent/young tiers get any treatment, and it
 * is limited to a soft left edge + faint tint (card) and a small pill (badge),
 * so the quiet majority of cards are untouched and text contrast is unchanged.
 */
export const CARD_ACCENT: Record<FreshnessTier, string> = {
  fresh: "border-l-[3px] border-l-emerald-400/70 bg-emerald-soft/40 hover:border-l-emerald-300",
  closing: "border-l-[3px] border-l-amber-400/70 bg-amber-soft/40 hover:border-l-amber-300",
  expired: "border-l-[3px] border-l-border-strong",
  recent: "",
  aging: "",
  unknown: "",
};

const BADGE_STYLE: Record<FreshnessTier, string> = {
  fresh: "border-emerald-line bg-emerald-soft text-emerald-ink",
  closing: "border-amber-line bg-amber-soft text-amber-ink",
  expired: "border-border bg-subtle text-muted",
  recent: "",
  aging: "",
  unknown: "",
};

const BADGE_DOT: Record<FreshnessTier, string> = {
  fresh: "bg-emerald-500",
  closing: "bg-amber-500",
  expired: "bg-faint",
  recent: "",
  aging: "",
  unknown: "",
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "");

export function FreshnessBadge({
  freshness,
  postedAt,
  deadline,
}: {
  freshness: FreshnessInfo;
  postedAt: string | null;
  deadline: string | null;
}) {
  if (!freshness.label) return null;
  const title =
    freshness.tier === "expired"
      ? `Deadline was ${deadline ? fmt(deadline) : "unspecified"}`
      : freshness.tier === "closing"
        ? `Deadline ${fmt(deadline)}`
        : `Posted ${fmt(postedAt)}`;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${BADGE_STYLE[freshness.tier]}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${BADGE_DOT[freshness.tier]}`} />
      {freshness.label}
    </span>
  );
}
