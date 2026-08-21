"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, SlidersHorizontal } from "lucide-react";
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

  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const remote = params.get("remote") ?? "";
  const visa = params.get("visa") ?? "";
  const showAll = params.get("showAll") ?? "";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <form
        className="flex min-w-56 flex-1 items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5"
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
          placeholder="Search title, company, tag…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
      </form>


      <select
        value={status}
        onChange={(e) => setParam("status", e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
      >
        <option value="">All statuses</option>
        <option value="new">New</option>
        <option value="favorite">Favorite</option>
        <option value="applied">Applied</option>
      </select>

      <select
        value={remote}
        onChange={(e) => setParam("remote", e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
        title="Work location"
      >
        <option value="">Any location</option>
        <option value="1">All remote</option>
        <option value="anywhere">🌍 Remote · anywhere</option>
        <option value="restricted">📍 Remote · select countries</option>
      </select>

      <label className="flex cursor-pointer items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={visa === "1"}
          onChange={(e) => setParam("visa", e.target.checked ? "1" : "")}
        />
        Visa/relocation
      </label>

      <label
        className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-700"
        title="Show listings that don't match your keywords too"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <input
          type="checkbox"
          checked={showAll === "1"}
          onChange={(e) => setParam("showAll", e.target.checked ? "1" : "")}
        />
        Show all
      </label>
    </div>
  );
}
