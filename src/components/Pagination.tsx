"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  currentPage: number;
  totalPages: number;
}

/** Windowed page list: 1 … 4 5 6 … 12 */
function buildPages(current: number, total: number): Array<number | "gap"> {
  const candidates = new Set<number>(
    [1, 2, current - 1, current, current + 1, total - 1, total].filter(
      (p) => p >= 1 && p <= total,
    ),
  );
  const sorted = [...candidates].sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out;
}

export function Pagination({ currentPage, totalPages }: Props) {
  const params = useSearchParams();

  if (totalPages <= 1) return null;

  const hrefFor = (page: number): string => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(page));
    return `/?${next.toString()}`;
  };

  const navClass =
    "inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:border-slate-400 disabled:pointer-events-none disabled:opacity-40";

  return (
    <nav className="flex flex-wrap items-center justify-center gap-1.5 pt-2" aria-label="Pagination">
      <Link
        href={hrefFor(Math.max(1, currentPage - 1))}
        aria-disabled={currentPage === 1}
        className={navClass}
        onClick={(e) => {
          if (currentPage === 1) e.preventDefault();
        }}
      >
        <ChevronLeft className="h-4 w-4" /> Prev
      </Link>

      {buildPages(currentPage, totalPages).map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="px-1 text-slate-400">
            …
          </span>
        ) : p === currentPage ? (
          <span
            key={p}
            aria-current="page"
            className="inline-flex min-w-9 justify-center rounded-lg bg-slate-900 px-2.5 py-1.5 text-sm font-semibold text-white"
          >
            {p}
          </span>
        ) : (
          <Link
            key={p}
            href={hrefFor(p)}
            className="inline-flex min-w-9 justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-600 transition hover:border-slate-400"
          >
            {p}
          </Link>
        ),
      )}

      <Link
        href={hrefFor(Math.min(totalPages, currentPage + 1))}
        aria-disabled={currentPage === totalPages}
        className={navClass}
        onClick={(e) => {
          if (currentPage === totalPages) e.preventDefault();
        }}
      >
        Next <ChevronRight className="h-4 w-4" />
      </Link>
    </nav>
  );
}
