import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  /** A single form control; id, aria-describedby and aria-invalid are injected. */
  children: ReactElement<Record<string, unknown>>;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const uid = useId();
  const id = (isValidElement(children) && (children.props.id as string | undefined)) || `${uid}-control`;
  const hintId = hint ? `${uid}-hint` : undefined;
  const errorId = error ? `${uid}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs-plus font-semibold text-foreground">
        {label}
      </label>
      {cloneElement(children, { id, "aria-describedby": describedBy, ...(error ? { "aria-invalid": true } : {}) })}
      {hint && <p id={hintId} className="text-xs text-muted">{hint}</p>}
      {error && <p id={errorId} className="text-xs font-semibold text-danger">{error}</p>}
    </div>
  );
}
