"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

interface Props {
  skills: Array<{ name: string; count: number }>;
}

/**
 * Faceted skill filter. Multiple selections = OR (a listing matches if it
 * has ANY selected skill). Selection lives in `?skill=` query params.
 */
export function SkillSidebar({ skills }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.getAll("skill");

  const toggle = useCallback(
    (name: string) => {
      const next = new URLSearchParams(params.toString());
      const current = next.getAll("skill");
      next.delete("page"); // filters changed → back to first page
      const updated = current.includes(name)
        ? current.filter((s) => s !== name)
        : [...current, name];
      updated.forEach((s) => next.append("skill", s));
      router.push(`/?${next.toString()}`);
    },
    [params, router],
  );

  const clearAll = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("skill");
    next.delete("page");
    router.push(`/?${next.toString()}`);
  }, [params, router]);

  return (
    <aside className="hidden w-52 shrink-0 lg:block">
      <div className="sticky top-16 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Skills
          </h2>
          {selected.length > 0 && (
            <button
              onClick={clearAll}
              className="text-xs text-emerald-600 hover:text-emerald-700"
            >
              clear ({selected.length})
            </button>
          )}
        </div>
        <ul className="max-h-[calc(100vh-10rem)] space-y-0.5 overflow-y-auto pr-1">
          {skills.map(({ name, count }) => {
            const active = selected.includes(name);
            return (
              <li key={name}>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm transition ${
                    active
                      ? "bg-emerald-50 font-medium text-emerald-800"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggle(name)}
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
    </aside>
  );
}
