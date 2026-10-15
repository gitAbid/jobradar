"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "default", pending = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dlg.showModal();
    } else if (!open) {
      if (dlg.open) dlg.close();
      trigger.current?.focus();
      trigger.current = null;
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Esc: React state owns the open flag, so don't let the browser close it.
        e.preventDefault();
        if (!pending) onCancel();
      }}
      className="m-auto w-full max-w-sm rounded-xl border border-border bg-surface-raised p-5 text-foreground shadow-overlay backdrop:bg-foreground/40"
    >
      <h2 id={titleId} className="text-base-plus font-bold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>{cancelLabel}</Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} pending={pending}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
