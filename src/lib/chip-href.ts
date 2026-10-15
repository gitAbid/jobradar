/**
 * Target for a skill chip. On the dashboard (`/`) it keeps the other active
 * filters and sets `q`; elsewhere (pages without `q` support) it goes to `/?q=`.
 */
export function skillChipHref(pathname: string, search: string, skill: string): string {
  if (pathname !== "/") return `/?q=${encodeURIComponent(skill)}`;
  const next = new URLSearchParams(search);
  next.delete("page");
  next.set("q", skill);
  return `/?${next.toString()}`;
}
