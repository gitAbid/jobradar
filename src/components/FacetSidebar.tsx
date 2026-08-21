"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { ChevronDown, X } from "lucide-react";

export interface FacetValue {
  name: string;
  count: number;
}

interface FacetSectionProps {
  title: string;
  param: string;
  values: FacetValue[];
  selected: string[];
  open: boolean;
  onToggleOpen: (param: string) => void;
  onToggle: (param: string, name: string) => void;
  onClearParam: (param: string) => void;
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
  open,
  onToggleOpen,
  onToggle,
  onClearParam,
}: FacetSectionProps) {
  return (
    <section
      className={`flex min-h-0 flex-col rounded-lg ${open ? "flex-1" : "shrink-0"}`}
    >
      <button
        onClick={() => onToggleOpen(param)}
        className="flex w-full items-center gap-1.5 px-1 py-1 text-left"
        aria-expanded={open}
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </span>
        {selected.length > 0 && (
          <span className="rounded-full bg-emerald-100 px-1.5 text-[11px] font-semibold text-emerald-700">
            {selected.length}
          </span>
        )}
        {selected.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onClearParam(param);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onClearParam(param);
              }
            }}
            className="ml-auto text-[11px] normal-case text-emerald-600 hover:text-emerald-700"
            title={`Clear ${title} filters`}
          >
            clear
          </span>
        )}
      </button>

      {open && (
        <ul className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
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
}

/**
 * Multi-facet collapsible filter sidebar. Sections toggle open/closed;
 * every open section shares the sidebar's remaining height (its list
 * scrolls internally). Within a facet selections OR together; across
 * facets they AND. Toggling any value resets pagination.
 */
export function FacetSidebar({ facets }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
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

  const toggleOpen = useCallback(
    (param: string) =>
      setOpenMap((prev) => ({ ...prev, [param]: !prev[param] })),
    [],
  );

  return (
    <aside className="hidden w-52 shrink-0 lg:block">
      <div className="sticky top-16 flex h-[calc(100vh-5rem)] flex-col gap-1 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {facets.map((f) => (
          <FacetSection
            key={f.param}
            title={f.title}
            param={f.param}
            values={f.values}
            selected={params.getAll(f.param)}
            open={openMap[f.param] ?? false}
            onToggleOpen={toggleOpen}
            onToggle={toggleValue}
            onClearParam={clearParam}
          />
        ))}
      </div>
    </aside>
  );
}
