/** Compact relative time ("3d ago", "2mo ago", "just now"). */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days > 30) return `${Math.floor(days / 30)}mo ago`;
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  return "just now";
}

/** Server-safe absolute fallback for <RelativeTime>: the ISO date, "YYYY-MM-DD". */
export function isoDate(iso: string): string {
  return iso.slice(0, 10);
}
