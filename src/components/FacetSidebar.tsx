"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

export interface FacetValue {
  name: string;
  count: number;
}

interface FacetSectionProps {
  title: string;
  param: string;
  values: FacetValue[];
  selected: string[];
  onToggle: (param: string, name: string) => void;
  onClearParam: (param: string) => void;
}

function FacetSection({
  title,
  param,
  values,
  selected,
  onToggle,
  onClearParam,
}: FacetSectionProps) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h3>
        {selected.length > 0 && (
          <button
            onClick={() => onClearParam(param)}
            className="text-[11px] text-emerald-600 hover:text-emerald-700"
          >
            clear ({selected.length})
          </button>
        )}
      </div>
      <ul className="max-h-44 space-y-0.5 overflow-y-auto pr-1">
        {values.map(({ name, count }) => {
          const active = selected.includes(name);
          return (
            <li key={name}>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-0.5 text-sm transition ${
                  active
                    ? "bg-emerald-50 font-medium text-emerald-800"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => onToggle(param, name)}
                  className="accent-emerald-600"
                />
                <span className="flex-1 truncate" title={name}>
                  {name}
                </span>
                <span className="text-xs text-slate-400">{count}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface Props {
  facets: Array<{
    title: string;
    param: string;
    values: FacetValue[];
  }>;
}

/**
 * Multi-facet filter sidebar. Each facet is a separate URL param (repeatable);
 * within a facet selections are OR-ed, across facets they combine with AND.
 * Toggling any facet resets pagination.
 */
export function FacetSidebar({ facets }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  const push = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      next.delete("page");
      mutate(next);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, router, pathname],
  );

  const toggle = useCallback(
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

  return (
    <aside className="hidden w-52 shrink-0 lg:block">
      <div className="sticky top-16 max-h-[calc(100vh-5rem)] space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {facets.map((f) => (
          <FacetSection
            key={f.param}
            title={f.title}
            param={f.param}
            values={f.values}
            selected={params.getAll(f.param)}
            onToggle={toggle}
            onClearParam={clearParam}
          />
        ))}
      </div>
    </aside>
  );
}
