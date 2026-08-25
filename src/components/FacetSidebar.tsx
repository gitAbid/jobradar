"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { ChevronDown, X, Pin, SlidersHorizontal } from "lucide-react";
import { togglePinCountryAction } from "@/app/actions";

export interface FacetValue {
  name: string;
  count: number;
}

interface FacetSectionProps {
  title: string;
  param: string;
  values: FacetValue[];
  selected: string[];
  pinnedCountries: string[];
  open: boolean;
  onToggleOpen: (param: string) => void;
  onToggle: (param: string, name: string) => void;
  onClearParam: (param: string) => void;
  mobile?: boolean;
}

/**
 * One collapsible facet group. Collapsed = header only; open = the section
 * stretches (flex-1) to share the sidebar's remaining vertical space and
 * scrolls its own list internally.
 */
function FacetSection({
  title,
  param,
  values,
  selected,
  pinnedCountries,
  open,
  onToggleOpen,
  onToggle,
  onClearParam,
  mobile = false,
}: FacetSectionProps) {
  const pinnable = param === "country";
  const valuesId = `${param}-facet-values${mobile ? "-mobile" : ""}`;
  return (
    <section
      className={`flex min-h-0 flex-col rounded-lg ${mobile ? "shrink-0" : open ? "flex-1" : "shrink-0"}`}
    >
      <div className="flex items-center gap-1.5 px-1 py-1">
        <button
          type="button"
          onClick={() => onToggleOpen(param)}
          className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          aria-expanded={open}
          aria-controls={valuesId}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
              open ? "" : "-rotate-90"
            }`}
          />
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            {title}
          </span>
          <span className="text-[11px] text-slate-400">{values.length}</span>
          {selected.length > 0 && (
            <span className="rounded-full bg-teal-100 px-1.5 text-[11px] font-semibold text-teal-700">
              {selected.length}
            </span>
          )}
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onClearParam(param)}
            className="rounded-md px-1.5 py-1 text-[11px] normal-case text-teal-700 hover:bg-teal-50 hover:text-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            title={`Clear ${title} filters`}
          >
            clear
          </button>
        )}
      </div>

      {open && (
        <ul id={valuesId} className={`sleek-scrollbar mt-1 min-h-0 space-y-0.5 overflow-y-auto pr-1 ${mobile ? "max-h-48" : "flex-1"}`}>
          {values.map(({ name, count }) => {
            const active = selected.includes(name);
            const pinned = pinnedCountries.includes(name.toLowerCase());
            return (
              <li key={name} className="group/row flex items-center gap-0.5">
                <label
                  className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 py-0.5 text-sm transition ${
                    active
                      ? "bg-emerald-50 font-medium text-emerald-800"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => onToggle(param, name)}
                    className="h-4 w-4 accent-teal-600"
                  />
                  <span className="min-w-0 flex-1 truncate" title={name}>
                    {name}
                  </span>
                  <span className="text-xs text-slate-400">{count}</span>
                </label>
                {pinnable && (
                  <form action={togglePinCountryAction}>
                    <input type="hidden" name="country" value={name} />
                    <button
                      type="submit"
                      title={pinned ? `Unpin ${name} from nav` : `Pin ${name} to nav bar`}
                      className={`rounded p-1 transition ${
                        pinned
                          ? "text-emerald-600 hover:text-emerald-700"
                          : "text-slate-300 opacity-0 hover:bg-slate-100 hover:text-slate-500 focus:opacity-100 group-hover/row:opacity-100"
                      }`}
                    >
                      <Pin className={`h-3 w-3 ${pinned ? "fill-current" : ""}`} />
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* selected-but-collapsed reminder strip */}
      {!open && selected.length > 0 && (
        <div className="flex flex-wrap gap-1 pb-1 pl-6">
          {selected.map((s) => (
            <span
              key={s}
              className="max-w-full truncate rounded bg-emerald-50 px-1.5 text-[11px] text-emerald-700"
              title={s}
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

interface Props {
  facets: Array<{
    title: string;
    param: string;
    values: FacetValue[];
  }>;
  pinnedCountries?: string[];
}

/**
 * Multi-facet collapsible filter sidebar. Sections toggle open/closed;
 * every open section shares the sidebar's remaining height (its list
 * scrolls internally). Within a facet selections OR together; across
 * facets they AND. Toggling any value resets pagination.
 */
export function FacetSidebar({ facets, pinnedCountries = [] }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // first facet starts open, everything else collapsed
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(facets.map((f, i) => [f.param, i === 0])),
  );

  const push = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      next.delete("page");
      mutate(next);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, router, pathname],
  );

  const toggleValue = useCallback(
    (param: string, name: string) =>
      push((next) => {
        const current = next.getAll(param);
        next.delete(param);
        const updated = current.includes(name)
          ? current.filter((s) => s !== name)
          : [...current, name];
        updated.forEach((s) => next.append(param, s));
      }),
    [push],
  );

  const clearParam = useCallback(
    (param: string) =>
      push((next) => {
        next.delete(param);
      }),
    [push],
  );

  const clearAll = useCallback(() => {
    push((next) => {
      ["q", "status", "remote", "visa", "showAll", ...facets.map((f) => f.param)].forEach((key) =>
        next.delete(key),
      );
    });
    setMobileOpen(false);
  }, [facets, push]);

  const toggleOpen = useCallback(
    (param: string) =>
      setOpenMap((prev) => ({ ...prev, [param]: !prev[param] })),
    [],
  );

  const selectedCount = facets.reduce((count, facet) => count + params.getAll(facet.param).length, 0);
  const hasFilters = selectedCount > 0 || Boolean(params.get("q") || params.get("status") || params.get("remote") || params.get("visa") || params.get("showAll"));

  return (
    <>
      <aside className="hidden w-56 shrink-0 lg:block">
        <div className="sticky top-[8.75rem] flex h-[calc(100vh-10rem)] flex-col gap-1 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_12px_35px_rgb(15_42_67/0.06)]">
          <div className="mb-2 flex items-center justify-between border-b border-slate-100 px-1 pb-3">
            <div>
              <p className="text-sm font-bold text-slate-900">Refine results</p>
              <p className="mt-0.5 text-[11px] text-slate-400">Choose more than one</p>
            </div>
            {hasFilters && (
              <button
                type="button"
                onClick={clearAll}
                className="rounded-lg px-2 py-1 text-[11px] font-semibold text-teal-700 transition-colors hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
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
                    onToggleOpen={toggleOpen}
                    onToggle={toggleValue}
                    onClearParam={clearParam}
                    mobile
                  />
                ))}
              </div>
              <div className="mt-5 flex gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={clearAll}
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
    </>
  );
}
