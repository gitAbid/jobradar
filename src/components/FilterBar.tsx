"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useCallback } from "react";

export function FilterBar() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page"); // filters changed → back to first page
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, router, pathname],
  );

  const clearQuickFilters = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    ["q", "status", "remote", "visa", "showAll"].forEach((key) => next.delete(key));
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }, [params, router, pathname]);

  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const remote = params.get("remote") ?? "";
  const visa = params.get("visa") ?? "";
  const showAll = params.get("showAll") ?? "";
  const hasQuickFilters = Boolean(q || status || remote || visa === "1" || showAll === "1");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_10px_28px_rgb(15_42_67/0.05)] sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
      <form
        key={`search-${q}`}
        className="flex min-h-11 min-w-56 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 transition-colors focus-within:border-teal-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-100"
        onSubmit={(e) => {
          e.preventDefault();
          const input = (e.currentTarget.elements.namedItem("q") as HTMLInputElement).value;
          setParam("q", input);
        }}
      >
        <Search className="h-4 w-4 text-slate-400" />
        <input
          name="q"
          defaultValue={q}
          aria-label="Search jobs"
          placeholder="Search title, company, skill..."
          className="w-full bg-transparent text-[15px] outline-none placeholder:text-slate-400"
        />
        {q && (
          <button
            type="button"
            onClick={() => setParam("q", "")}
            aria-label="Clear search"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>

      <select
        value={status}
        onChange={(e) => setParam("status", e.target.value)}
        aria-label="Filter by status"
        className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 transition-colors hover:border-slate-400 focus-visible:ring-2 focus-visible:ring-teal-500"
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
        className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 transition-colors hover:border-slate-400 focus-visible:ring-2 focus-visible:ring-teal-500"
        title="Work location"
      >
        <option value="">Location: any</option>
        <option value="1">Remote: all</option>
        <option value="anywhere">Remote: anywhere</option>
        <option value="restricted">Remote: select countries</option>
      </select>

      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 transition-colors hover:border-slate-400 has-[:checked]:border-sky-300 has-[:checked]:bg-sky-50 has-[:checked]:text-sky-800">
        <input
          type="checkbox"
          checked={visa === "1"}
          onChange={(e) => setParam("visa", e.target.checked ? "1" : "")}
          className="h-4 w-4 accent-sky-600"
        />
        Visa support
      </label>

      <label
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 has-[:checked]:border-violet-300 has-[:checked]:bg-violet-50 has-[:checked]:text-violet-800"
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
        <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Quick filters active</span>
          <button
            type="button"
            onClick={clearQuickFilters}
            className="text-xs font-semibold text-teal-700 hover:text-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
