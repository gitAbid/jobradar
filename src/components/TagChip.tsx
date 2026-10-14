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
  removeLabel,
  disabled,
}: {
  variant: "skill" | "board" | "user";
  children: ReactNode;
  href?: string;
  title?: string;
  removable?: boolean;
  /** Accessible name for the removable chip, e.g. "Remove tag #remote". */
  removeLabel?: string;
  disabled?: boolean;
}) {
  if (variant === "skill" && href) {
    return (
      <Link
        href={href}
        title={title}
        className="inline-flex items-center rounded-lg border border-teal-line bg-teal-soft px-2 py-1 text-[11px] pointer-coarse:min-h-11 pointer-coarse:px-3 font-semibold text-teal-ink transition-colors hover:border-teal-line hover:bg-teal-soft2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        {children}
      </Link>
    );
  }
  if (variant === "board") {
    return <span className="rounded-lg bg-subtle px-2 py-1 text-[11px] text-muted">{children}</span>;
  }
  if (removable) {
    return (
      <button
        type="submit"
        disabled={disabled}
        aria-label={removeLabel}
        aria-busy={disabled || undefined}
        className="inline-flex min-h-8 items-center gap-0.5 pointer-coarse:min-h-11 rounded-lg border border-violet-line bg-violet-soft px-2 py-0.5 text-[11px] font-medium text-violet-ink hover:bg-violet-soft2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60"
      >
        {children} <X aria-hidden="true" className="h-2.5 w-2.5" />
      </button>
    );
  }
  return (
    <span className="rounded-lg border border-violet-line bg-violet-soft px-2 py-1 text-[11px] font-medium text-violet-ink">
      {children}
    </span>
  );
}
