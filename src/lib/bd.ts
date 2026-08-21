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
