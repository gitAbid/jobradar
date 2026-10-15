import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "primary" | "accent" | "danger";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface text-muted",
  primary: "bg-primary text-primary-foreground",
  accent: "bg-accent text-primary-foreground",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", className = "", ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span {...rest} className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-bold uppercase ${tones[tone]} ${className}`} />;
}
