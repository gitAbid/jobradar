import { matchedKeywords, matchesKeywords } from "@/lib/filters";
import { computeFacet, countryFacetValue, topValues } from "@/lib/facets";
import type { FilterableListing } from "@/lib/types";

/**
 * Cascading faceted search: every facet's counts are recomputed from the
 * result set of ALL other active selections (its own selection is ignored
 * when counting itself), so the sidebar always reflects "what's still
 * available" given everything else the user has chosen.
 */

export const PAGE_SIZE = 20;

interface RawParams {
  status?: string;
  remote?: string;
  visa?: string;
  showAll?: string;
  q?: string;
  skill?: string | string[];
  country?: string | string[];
  company?: string | string[];
  source?: string | string[];
  page?: string;
}

export type FacetParam = "skill" | "country" | "company" | "source";
const FACET_PARAMS: FacetParam[] = ["skill", "country", "company", "source"];

const FACET_TITLES: Record<FacetParam, string> = {
  skill: "Skills",
  country: "Country",
  company: "Company",
  source: "Source",
};

export interface JobEntry {
  listing: FilterableListing;
  matched: string[];
}

export interface JobView {
  /** deduped + paginated entries ready to render */
  entries: JobEntry[];
  totalVisible: number;
  totalNew: number;
  currentPage: number;
  totalPages: number;
  selections: Record<FacetParam, string[]>;
  facets: Array<{ title: string; param: FacetParam; values: { name: string; count: number }[] }>;
}

function selectedParam(value?: string | string[]): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function buildJobView(
  pool: FilterableListing[],
  sp: RawParams,
  globalKeywords: string[],
): JobView {
  const showAll = sp.showAll === "1";

  const selections: Record<FacetParam, string[]> = {
    skill: selectedParam(sp.skill),
    country: selectedParam(sp.country),
    company: selectedParam(sp.company),
    source: selectedParam(sp.source),
  };

  // ── the one true filter pipeline ────────────────────────────────────────
  const runPipeline = (exclude?: FacetParam): FilterableListing[] => {
    let ls = pool.filter((l) => l.status !== "hidden");

    if (sp.status) ls = ls.filter((l) => l.status === sp.status);

    if (sp.remote === "1") ls = ls.filter((l) => l.isRemote);
    else if (sp.remote === "anywhere")
      ls = ls.filter((l) => l.isRemote && l.remoteScope === "anywhere");
    else if (sp.remote === "restricted")
      ls = ls.filter((l) => l.isRemote && l.remoteScope === "restricted");
    if (sp.visa === "1") ls = ls.filter((l) => l.visaSponsorship);

    for (const param of FACET_PARAMS) {
      if (param === exclude) continue; // a facet ignores its own selection
      const sel = selections[param];
      if (sel.length === 0) continue;
      ls = ls.filter((l) => {
        switch (param) {
          case "skill":
            return sel.some((s) => l.skills.includes(s));
          case "country":
            return sel.includes(countryFacetValue(l));
          case "company":
            return sel.includes(l.company);
          case "source":
            return sel.includes(l.boardName);
        }
      });
    }

    if (sp.q) {
      const q = sp.q.toLowerCase();
      ls = ls.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          l.company.toLowerCase().includes(q) ||
          l.location.toLowerCase().includes(q) ||
          l.tags.some((t) => t.toLowerCase().includes(q)) ||
          l.skills.some((s) => s.toLowerCase().includes(q)),
      );
    }

    // global keyword filter (skipped when "Show all" is on)
    if (!showAll) ls = ls.filter((l) => matchesKeywords(l, globalKeywords));

    return ls;
  };

  // ── cascading facet counts ──────────────────────────────────────────────
  const keyFns: Record<
    FacetParam,
    (l: FilterableListing) => string | null
  > = {
    skill: null as never, // handled specially below
    country: countryFacetValue,
    company: (l) => l.company || null,
    source: (l) => l.boardName,
  };

  const facetValues: Record<FacetParam, { name: string; count: number }[]> =
    {} as never;
  for (const param of FACET_PARAMS) {
    const remaining = runPipeline(param);
    if (param === "skill") {
      const counts = new Map<string, number>();
      for (const l of remaining)
        for (const s of l.skills)
          counts.set(s, (counts.get(s) ?? 0) + 1);
      facetValues.skill = topValues(counts);
    } else {
      facetValues[param] = topValues(computeFacet(remaining, keyFns[param]));
    }
    // keep the user's chosen values visible even at zero count elsewhere
    for (const s of selections[param]) {
      if (!facetValues[param].some((v) => v.name === s))
        facetValues[param].push({ name: s, count: 0 });
    }
  }

  // ── main result set ─────────────────────────────────────────────────────
  const resultSet = runPipeline();

  const totalNew = pool.filter(
    (l) => l.status !== "hidden" && l.status === "new",
  ).length;

  // dedupe identical role postings (company boards post per-location)
  const seenKeys = new Set<string>();
  const unique = resultSet.filter((listing) => {
    const key = `${listing.company}|${listing.title}`.toLowerCase();
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  const totalVisible = unique.length;
  const totalPages = Math.max(1, Math.ceil(totalVisible / PAGE_SIZE));
  const requestedPage = Number.parseInt(sp.page ?? "1", 10);
  const currentPage = Math.min(
    Math.max(Number.isNaN(requestedPage) ? 1 : requestedPage, 1),
    totalPages,
  );

  const entries: JobEntry[] = unique
    .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    .map((listing) => ({
      listing,
      matched: matchedKeywords(listing, globalKeywords),
    }));

  const facets = FACET_PARAMS.map((param) => ({
    title: FACET_TITLES[param],
    param,
    values: facetValues[param],
  }));

  return {
    entries,
    totalVisible,
    totalNew,
    currentPage,
    totalPages,
    selections,
    facets,
  };
}
