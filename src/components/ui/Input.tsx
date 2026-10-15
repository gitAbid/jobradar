import type { InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ error, className = "", ...rest }: InputProps) {
  return (
    <input
      {...rest}
      aria-invalid={error ? true : rest["aria-invalid"]}
      className={`min-h-11 w-full min-w-0 rounded-lg border bg-surface-raised px-3 py-2 text-sm text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${error ? "border-danger" : "border-border-strong"} ${className}`}
    />
  );
}
