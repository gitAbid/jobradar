import type { HTMLAttributes } from "react";

export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={`rounded-xl border border-border bg-surface-raised p-4 shadow-sm sm:p-5 ${className}`} />;
}
