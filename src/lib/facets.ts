/**
 * Country facet extraction from free-form location strings.
 * Boards write locations inconsistently ("Dhaka (DOHS Mirpur)", "Berlin,
 * Germany", "USA Only", "Remote") — we map them onto a curated
 * country/region vocabulary, with cities standing in for their countries.
 */

export const COUNTRY_FACETS: Array<[string, RegExp]> = [
  ["Bangladesh", /\b(bangladesh|dhaka|gulshan|banani|baridhara|mohakhali|mirpur|uttara|bashundhara|dhanmondi|motijheel|tejgaon|kawran|chattogram|chittagong|sylhet|khulna|rajshahi|barishal|barisal|rangpur|mymensingh|narayanganj|gazipur|cumilla|comilla|bogura|jashore|jessore|savar|keraniganj)\b/i],
  ["Germany", /\b(germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|düsseldorf|leipzig)\b/i],
  ["United States", /\b(usa?|u\.s\.a?|united states|america|new york|san francisco|bay area|seattle|austin|texas|california|boston|chicago|denver|atlanta|miami|remote jobs usa?)\b/i],
  ["United Kingdom", /\b(united kingdom|uk|britain|england|london|manchester|birmingham|edinburgh|scotland|wales)\b/i],
  ["India", /\b(india|bangalore|bengaluru|mumbai|delhi|pune|hyderabad|chennai|noida|gurgaon|gurugram|kolkata)\b/i],
  ["Canada", /\b(canada|canadian|toronto|vancouver|montreal|ottawa|calgary)\b/i],
  ["Netherlands", /\b(netherlands|holland|amsterdam|rotterdam|eindhoven|utrecht)\b/i],
  ["Poland", /\b(poland|polish|warsaw|krakow|kraków|wroclaw|gdansk)\b/i],
  ["France", /\b(france|paris|lyon|toulouse)\b/i],
  ["Spain", /\b(spain|spanish|madrid|barcelona|valencia)\b/i],
  ["Portugal", /\b(portugal|lisbon|porto)\b/i],
  ["Ireland", /\b(ireland|irish|dublin)\b/i],
  ["Sweden", /\b(sweden|swedish|stockholm)\b/i],
  ["Denmark", /\b(denmark|danish|copenhagen|aarhus)\b/i],
  ["Norway", /\b(norway|norwegian|oslo|bergen)\b/i],
  ["Switzerland", /\b(switzerland|swiss|zurich|zürich|geneva|bern)\b/i],
  ["Austria", /\b(austria|vienna)\b/i],
  ["Belgium", /\b(belgium|brussels|antwerp)\b/i],
  ["Italy", /\b(italy|italian|milan|rome)\b/i],
  ["Romania", /\b(romania|romanian|bucharest|cluj)\b/i],
  ["Ukraine", /\b(ukraine|kyiv|kiev)\b/i],
  ["Czechia", /\b(czechia|czech republic|prague)\b/i],
  ["Estonia", /\b(estonia|tallinn)\b/i],
  ["Lithuania", /\b(lithuania|vilnius)\b/i],
  ["Japan", /\b(japan|japanese|tokyo|osaka)\b/i],
  ["Singapore", /\b(singapore)\b/i],
  ["Australia", /\b(australia|australian|sydney|melbourne|brisbane|perth)\b/i],
  ["New Zealand", /\b(new zealand|auckland|wellington)\b/i],
  ["UAE", /\b(uae|united arab emirates|dubai|abu dhabi|sharjah)\b/i],
  ["Saudi Arabia", /\b(saudi arabia|riyadh|jeddah)\b/i],
  ["Qatar", /\b(qatar|doha)\b/i],
  ["Philippines", /\b(philippines|filipino|manila)\b/i],
  ["Vietnam", /\b(vietnam|vietnamese|hanoi|ho chi minh)\b/i],
  ["Pakistan", /\b(pakistan|pakistani|karachi|lahore|islamabad)\b/i],
  ["Egypt", /\b(egypt|egyptian|cairo)\b/i],
  ["Kenya", /\b(kenya|nairobi)\b/i],
  ["Nigeria", /\b(nigeria|lagos|abuja)\b/i],
  ["South Africa", /\b(south africa|johannesburg|cape town)\b/i],
  ["Brazil", /\b(brazil|brazilian|sao paulo|são paulo|rio de janeiro)\b/i],
  ["Mexico", /\b(mexico|mexico city|guadalajara)\b/i],
  ["Argentina", /\b(argentina|buenos aires)\b/i],
  ["Colombia", /\b(colombia|bogota|bogotá)\b/i],
  ["China", /\b(china|chinese|beijing|shanghai|shenzhen)\b/i],
  ["Hong Kong", /\b(hong kong)\b/i],
  ["Malaysia", /\b(malaysia|kuala lumpur)\b/i],
  ["Indonesia", /\b(indonesia|jakarta)\b/i],
  ["Thailand", /\b(thailand|bangkok)\b/i],
  ["Turkey", /\b(turkey|turkish|istanbul|ankara)\b/i],
];

export function extractCountry(location: string): string | null {
  for (const [country, re] of COUNTRY_FACETS) {
    if (re.test(location)) return country;
  }
  return null;
}

/** Facet value for a listing: mapped country, else Remote/Anywhere, else Other. */
export function countryFacetValue(listing: {
  location: string;
  isRemote: boolean;
  remoteScope?: string | null;
}): string {
  const mapped = extractCountry(listing.location);
  if (mapped) return mapped;
  if (listing.isRemote && listing.remoteScope === "anywhere") return "Remote · Anywhere";
  if (/remote|anywhere/i.test(listing.location)) return "Remote · Anywhere";
  return "Other";
}

// ── Generic facet computation ──────────────────────────────────────────────

export interface FacetValue {
  name: string;
  count: number;
}

/** Count occurrences of key(listing) over non-hidden listings. */
export function computeFacet<T>(
  listings: T[],
  keyFn: (item: T) => string | null,
  opts: { skipHidden?: boolean; statusKey?: (item: T) => string } = {},
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of listings) {
    if (opts.skipHidden && opts.statusKey?.(l) === "hidden") continue;
    const k = keyFn(l);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function topValues(counts: Map<string, number>, limit?: number): FacetValue[] {
  const all = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return limit ? all.slice(0, limit) : all;
}

/** Normalize a possibly-repeated searchParams value into string[]. */
export function selectedParam(value?: string | string[]): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
