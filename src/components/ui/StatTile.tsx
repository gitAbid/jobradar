import type { ReactNode } from "react";

export function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-surface px-3 py-2">
      <p className="text-2xs font-bold uppercase text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}
