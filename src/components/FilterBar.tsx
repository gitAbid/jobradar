"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { QUICK_FILTER_KEYS, useFacetParams } from "@/lib/use-facet-params";

export function FilterBar() {
  const pathname = usePathname();
  const { params, setParam, clearParams } = useFacetParams();
  const clearQuickFilters = useCallback(() => clearParams(QUICK_FILTER_KEYS), [clearParams]);

  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const remote = params.get("remote") ?? "";
  const visa = params.get("visa") ?? "";
  const showAll = params.get("showAll") ?? "";
  const hasQuickFilters = Boolean(q || status || remote || visa === "1" || showAll === "1");

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-3 shadow-[0_10px_28px_rgb(15_42_67/0.05)] sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
      <form
        key={`search-${q}`}
        action={pathname}
        method="get"
        role="search"
        className="flex min-h-11 min-w-56 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 transition-colors focus-within:border-teal-line focus-within:bg-surface-raised focus-within:ring-2 focus-within:ring-teal-100"
        onSubmit={(e) => {
          e.preventDefault();
          const input = (e.currentTarget.elements.namedItem("q") as HTMLInputElement).value;
          setParam("q", input);
        }}
      >
        {/* no-JS fallback: a plain GET keeps every other param (page resets) */}
        {Array.from(params.entries())
          .filter(([k]) => k !== "q" && k !== "page")
          .map(([k, v], i) => (
            <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
          ))}
        <Search aria-hidden="true" className="h-4 w-4 text-faint" />
        <input
          name="q"
          defaultValue={q}
          aria-label="Search jobs"
          placeholder="Search title, company, skill..."
          className="w-full bg-transparent text-[15px] outline-none placeholder:text-faint"
        />
        <button type="submit" className="sr-only">
          Search
        </button>
        {q && (
          <button
            type="button"
            onClick={() => setParam("q", "")}
            aria-label="Clear search"
            className="inline-flex h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11 shrink-0 items-center justify-center rounded-lg text-faint hover:bg-subtle-2 hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>

      <select
        value={status}
        onChange={(e) => setParam("status", e.target.value)}
        aria-label="Filter by status"
        className="min-h-11 rounded-xl border border-border bg-surface-raised px-3 text-sm text-muted transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        <option value="">Status: all</option>
        <option value="new">New</option>
        <option value="favorite">Favorite</option>
        <option value="applied">Applied</option>
      </select>

      <select
        value={remote}
        onChange={(e) => setParam("remote", e.target.value)}
        aria-label="Filter by work location"
        className="min-h-11 rounded-xl border border-border bg-surface-raised px-3 text-sm text-muted transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-teal-500"
        title="Work location"
      >
        <option value="">Location: any</option>
        <option value="1">Remote: all</option>
        <option value="anywhere">Remote: anywhere</option>
        <option value="restricted">Remote: select countries</option>
      </select>

      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 text-sm text-muted transition-colors hover:border-border-strong has-[:checked]:border-sky-line has-[:checked]:bg-sky-soft has-[:checked]:text-sky-ink">
        <input
          type="checkbox"
          checked={visa === "1"}
          onChange={(e) => setParam("visa", e.target.checked ? "1" : "")}
          className="h-4 w-4 accent-sky-600"
        />
        Visa support
      </label>

      <label
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 text-sm font-medium text-muted transition-colors hover:border-border-strong has-[:checked]:border-violet-line has-[:checked]:bg-violet-soft has-[:checked]:text-violet-ink"
        title="Show listings that don't match your keywords too"
      >
        <SlidersHorizontal className="h-4 w-4 text-violet-600" />
        <input
          type="checkbox"
          checked={showAll === "1"}
          onChange={(e) => setParam("showAll", e.target.checked ? "1" : "")}
          className="h-4 w-4 accent-violet-600"
        />
        Show all
      </label>
      </div>
      {hasQuickFilters && (
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Quick filters active</span>
          <button
            type="button"
            onClick={clearQuickFilters}
            className="inline-flex min-h-8 pointer-coarse:min-h-11 items-center text-xs font-semibold text-teal-ink hover:text-teal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
