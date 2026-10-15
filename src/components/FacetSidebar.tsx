"use client";

import { useCallback, useState } from "react";
import { FacetSection } from "@/components/FacetSection";
import { MobileFilterSheet, type FacetGroup } from "@/components/MobileFilterSheet";
import { QUICK_FILTER_KEYS, useFacetParams } from "@/lib/use-facet-params";

interface Props {
  facets: FacetGroup[];
  pinnedCountries?: string[];
}

/**
 * Multi-facet collapsible filter sidebar. Sections toggle open/closed;
 * every open section shares the sidebar's remaining height (its list
 * scrolls internally). Within a facet selections OR together; across
 * facets they AND. Toggling any value resets pagination.
 */
export function FacetSidebar({ facets, pinnedCountries = [] }: Props) {
  const { params, toggleValue, clearParams } = useFacetParams();
  // first facet starts open, everything else collapsed
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(facets.map((f, i) => [f.param, i === 0])),
  );

  const clearParam = useCallback((param: string) => clearParams([param]), [clearParams]);

  const clearAll = useCallback(
    () => clearParams([...QUICK_FILTER_KEYS, ...facets.map((f) => f.param)]),
    [clearParams, facets],
  );

  const toggleOpen = useCallback(
    (param: string) => setOpenMap((prev) => ({ ...prev, [param]: !prev[param] })),
    [],
  );

  const selectedCount = facets.reduce((count, facet) => count + params.getAll(facet.param).length, 0);
  const hasFilters = selectedCount > 0 || QUICK_FILTER_KEYS.some((key) => Boolean(params.get(key)));

  return (
    <>
      <aside className="hidden w-56 shrink-0 lg:block">
        <div className="sticky top-[8.75rem] flex h-[calc(100vh-10rem)] flex-col gap-1 overflow-hidden rounded-2xl border border-border bg-surface-raised p-3 shadow-[0_12px_35px_rgb(15_42_67/0.06)]">
          <div className="mb-2 flex items-center justify-between border-b border-border px-1 pb-3">
            <div>
              <p className="text-sm font-bold text-foreground">Refine results</p>
              <p className="mt-0.5 text-[11px] text-faint">Choose more than one</p>
            </div>
            {hasFilters && (
              <button
                type="button"
                onClick={clearAll}
                className="rounded-lg px-2 py-1 text-[11px] font-semibold text-teal-ink transition-colors hover:bg-teal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              >
                Clear all
              </button>
            )}
          </div>
          {facets.map((f) => (
            <FacetSection
              key={f.param}
              title={f.title}
              param={f.param}
              values={f.values}
              selected={params.getAll(f.param)}
              pinnedCountries={pinnedCountries}
              open={openMap[f.param] ?? false}
              onToggleOpen={toggleOpen}
              onToggle={toggleValue}
              onClearParam={clearParam}
            />
          ))}
        </div>
      </aside>

      <MobileFilterSheet
        facets={facets}
        params={params}
        pinnedCountries={pinnedCountries}
        openMap={openMap}
        selectedCount={selectedCount}
        hasFilters={hasFilters}
        onToggleOpen={toggleOpen}
        onToggle={toggleValue}
        onClearParam={clearParam}
        onClearAll={clearAll}
      />
    </>
  );
}
