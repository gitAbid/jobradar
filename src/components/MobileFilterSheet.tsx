"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const openerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    const opener = openerRef.current;
    const dialog = dialogRef.current;

    // Background inert: everything in <body> except the portal'd dialog.
    const inerted: Element[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === dialog || el.hasAttribute("inert")) continue;
      el.setAttribute("inert", "");
      inerted.push(el);
    }
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      for (const el of inerted) el.removeAttribute("inert");
      opener?.focus();
    };
  }, [mobileOpen]);

  return (
    <div className="lg:hidden">
      <button
        ref={openerRef}
        type="button"
        onClick={() => setMobileOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface-raised px-3.5 text-sm font-semibold text-muted shadow-sm transition-colors hover:border-teal-line hover:text-teal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        aria-haspopup="dialog"
        aria-expanded={mobileOpen}
      >
        <SlidersHorizontal className="h-4 w-4 text-primary" />
        Filters
        {selectedCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-600 px-1.5 text-[11px] font-bold text-white">
            {selectedCount}
          </span>
        )}
      </button>

      {mobileOpen && createPortal(
        <div ref={dialogRef} className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filter jobs">
          <button
            type="button"
            aria-label="Dismiss filter panel"
            tabIndex={-1}
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-3xl border border-border bg-sand p-4 shadow-[0_-20px_55px_rgb(15_42_67/0.2)] sm:left-auto sm:inset-y-0 sm:bottom-auto sm:w-[min(26rem,92vw)] sm:rounded-none sm:rounded-l-3xl">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-subtle-2 sm:hidden" />
            <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
              <div>
                <p className="text-lg font-bold text-foreground">Refine results</p>
                <p className="mt-1 text-sm text-muted">Narrow the list without losing your place.</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close filters"
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface-raised text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
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
            <div className="mt-5 flex gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => {
                  onClearAll();
                  setMobileOpen(false);
                }}
                disabled={!hasFilters}
                className="min-h-11 flex-1 rounded-xl border border-border bg-surface-raised px-4 text-sm font-semibold text-muted transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="min-h-11 flex-1 rounded-xl bg-ink px-4 text-sm font-semibold text-white transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              >
                See results
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
