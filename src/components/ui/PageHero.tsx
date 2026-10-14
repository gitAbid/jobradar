import type { ReactNode } from "react";

export function PageHero({ title, description, actions, stats }: { title: string; description?: ReactNode; actions?: ReactNode; stats?: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {stats && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{stats}</div>}
    </section>
  );
}
