/**
 * Bangladesh-relevance detection.
 *
 * A listing belongs in the BD section when either:
 *  1. its location points at Bangladesh (cities/areas included), or
 *  2. it is a remote role whose text says Bangladeshi candidates are welcome
 *     (e.g. "Remote — Bangladesh or India", "eligible to work in Bangladesh").
 */

const BD_LOCATION_RE =
  /\b(bangladesh|dhaka|gulshan|banani|baridhara|mohakhali|mirpur|uttara|bashundhara|dhanmondi|motijheel|kawran ?bazar|tejgaon|chattogram|chittagong|sylhet|khulna|rajshahi|barishal|barisal|rangpur|mymensingh|narayanganj|gazipur|comilla|cumilla|bogura|jashore|jessore)\b/i;

/**
 * LIKE patterns mirroring BD_LOCATION_RE for a SQL prefilter. Each pattern
 * is deliberately looser than its regex counterpart (`%term%` vs `\bterm\b`,
 * `%kawran%bazar%` vs `kawran ?bazar`), so the SQL result is always a
 * SUPERSET of `isBangladeshRelevant` matches — the JS check re-filters
 * precisely. Static list, never user input: safe to interpolate.
 */
const BD_LOCATION_PATTERNS = [
  "bangladesh",
  "dhaka",
  "gulshan",
  "banani",
  "baridhara",
  "mohakhali",
  "mirpur",
  "uttara",
  "bashundhara",
  "dhanmondi",
  "motijheel",
  "kawran%bazar",
  "tejgaon",
  "chattogram",
  "chittagong",
  "sylhet",
  "khulna",
  "rajshahi",
  "barishal",
  "barisal",
  "rangpur",
  "mymensingh",
  "narayanganj",
  "gazipur",
  "comilla",
  "cumilla",
  "bogura",
  "jashore",
  "jessore",
];

/**
 * SQL WHERE fragment limiting the BD page to candidate rows (a superset —
 * always re-filter with `isBangladeshRelevant`). Pulling only relevant rows
 * instead of the full table is what keeps the BD page off the transfer
 * quota: ~hundreds of rows instead of ~thousands.
 */
export function bdPrefilterWhere(): string {
  const locationLikes = BD_LOCATION_PATTERNS.map((p) => `lower(l.location) like '%${p}%'`);
  return `(${[...locationLikes, `lower(l.title) like '%bangladesh%'`, `l.search_text like '%bangladesh%'`].join(" or ")})`;
}

export function isBangladeshRelevant(listing: {
  location: string;
  title: string;
  /** prebuilt lowercase blob of title+company+tags+description (listings.search_text) */
  searchText?: string;
}): boolean {
  if (BD_LOCATION_RE.test(listing.location)) return true;
  const hay = `${listing.title} ${listing.searchText ?? ""}`;
  return /\bbangladesh/i.test(hay);
}
