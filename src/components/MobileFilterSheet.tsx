"use client";

import { useState } from "react";
import { X, SlidersHorizontal } from "lucide-react";
import { FacetSection, type FacetValue } from "@/components/FacetSection";

export interface FacetGroup {
  title: string;
  param: string;
  values: FacetValue[];
}

interface Props {
  facets: FacetGroup[];
  params: URLSearchParams;
  pinnedCountries: string[];
  openMap: Record<string, boolean>;
  selectedCount: number;
  hasFilters: boolean;
  onToggleOpen: (param: string) => void;
  onToggle: (param: string, name: string) => void;
  onClearParam: (param: string) => void;
  onClearAll: () => void;
}

/** Mobile trigger button + bottom-sheet/side-drawer holding the facet sections. */
export function MobileFilterSheet({
  facets,
  params,
  pinnedCountries,
  openMap,
  selectedCount,
  hasFilters,
  onToggleOpen,
  onToggle,
  onClearParam,
  onClearAll,
}: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-teal-300 hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        aria-haspopup="dialog"
        aria-expanded={mobileOpen}
      >
        <SlidersHorizontal className="h-4 w-4 text-teal-600" />
        Filters
        {selectedCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-600 px-1.5 text-[11px] font-bold text-white">
            {selectedCount}
          </span>
        )}
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filter jobs">
          <button
            type="button"
            aria-label="Dismiss filter panel"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-3xl border border-slate-200 bg-sand p-4 shadow-[0_-20px_55px_rgb(15_42_67/0.2)] sm:left-auto sm:inset-y-0 sm:bottom-auto sm:w-[min(26rem,92vw)] sm:rounded-none sm:rounded-l-3xl">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden" />
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <p className="text-lg font-bold text-slate-950">Refine results</p>
                <p className="mt-1 text-sm text-slate-500">Narrow the list without losing your place.</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close filters"
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {facets.map((f) => (
                <FacetSection
                  key={f.param}
                  title={f.title}
                  param={f.param}
                  values={f.values}
                  selected={params.getAll(f.param)}
                  pinnedCountries={pinnedCountries}
                  open={openMap[f.param] ?? false}
                  onToggleOpen={onToggleOpen}
                  onToggle={onToggle}
                  onClearParam={onClearParam}
                  mobile
                />
              ))}
            </div>
            <div className="mt-5 flex gap-2 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => {
                  onClearAll();
                  setMobileOpen(false);
                }}
                disabled={!hasFilters}
                className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition-colors hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="min-h-11 flex-1 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              >
                See results
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
