import type { ButtonHTMLAttributes } from "react";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "aria-pressed"> {
  label: string;
  pressed?: boolean;
}

export function IconButton({ label, pressed, className = "", children, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      aria-label={label}
      aria-pressed={pressed}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 ${pressed ? "bg-surface text-foreground" : ""} ${className}`}
    >
      {children}
    </button>
  );
}
