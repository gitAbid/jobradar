import type { ReactNode } from "react";

export interface EmptyStateProps {
  variant?: "empty" | "filtered";
  title: string;
  description?: ReactNode;
  /** Primary action (e.g. add a board). */
  action?: ReactNode;
  /** Shown only for the `filtered` variant (e.g. a "Clear filters" button). */
  clearFilters?: ReactNode;
}

export function EmptyState({ variant = "empty", title, description, action, clearFilters }: EmptyStateProps) {
  return (
    <div data-variant={variant} className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface-raised px-6 py-10 text-center">
      <h2 className="text-base-plus font-bold text-foreground">{title}</h2>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {(action || (variant === "filtered" && clearFilters)) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {variant === "filtered" && clearFilters}
          {action}
        </div>
      )}
    </div>
  );
}
