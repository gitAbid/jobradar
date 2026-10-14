import Link from "next/link";
import { X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Small chip used on listing cards and pipeline cards.
 * - `skill`: link that filters the dashboard to that skill
 * - `board`: raw board tag
 * - `user`: your own #tag; with `removable` it renders a submit button
 *   (place it inside a form) with an X affordance.
 */
export function TagChip({
  variant,
  children,
  href,
  title,
  removable,
  disabled,
}: {
  variant: "skill" | "board" | "user";
  children: ReactNode;
  href?: string;
  title?: string;
  removable?: boolean;
  disabled?: boolean;
}) {
  if (variant === "skill" && href) {
    return (
      <Link
        href={href}
        title={title}
        className="rounded-lg border border-teal-100 bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-700 transition-colors hover:border-teal-200 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        {children}
      </Link>
    );
  }
  if (variant === "board") {
    return <span className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{children}</span>;
  }
  if (removable) {
    return (
      <button
        disabled={disabled}
        aria-busy={disabled || undefined}
        className="inline-flex min-h-8 items-center gap-0.5 rounded-lg border border-violet-100 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60"
      >
        {children} <X className="h-2.5 w-2.5" />
      </button>
    );
  }
  return (
    <span className="rounded-lg border border-violet-100 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700">
      {children}
    </span>
  );
}
