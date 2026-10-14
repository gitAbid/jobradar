import { ChevronDown } from "lucide-react";
import { PinButton } from "@/components/PinButton";

export interface FacetValue {
  name: string;
  count: number;
}

export interface FacetSectionProps {
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
export function FacetSection({
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
                  <PinButton name={name} pinned={pinned} />
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
