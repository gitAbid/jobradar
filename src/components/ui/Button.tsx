import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "border border-border-strong bg-surface-raised text-foreground hover:bg-surface",
  ghost: "text-foreground hover:bg-surface",
  danger: "bg-danger text-primary-foreground hover:opacity-90",
};
const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-xs-plus",
  md: "min-h-11 px-4 text-sm",
};

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pending?: boolean;
}

export function Button({ variant = "primary", size = "md", pending = false, disabled, className = "", children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending ? "true" : undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {pending && <Spinner />}
      {children}
    </button>
  );
}
