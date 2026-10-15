"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type ToastTone = "neutral" | "success" | "danger";
export interface ToastInput {
  message: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
}
interface ToastItem extends ToastInput { id: number }

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

const DISMISS_MS = 5000;
/** Toasts with an action (e.g. Undo) stay longer so there is time to use it. */
const ACTION_DISMISS_MS = 10000;

const tones: Record<ToastTone, string> = {
  neutral: "border-border-strong",
  success: "border-primary",
  danger: "border-danger",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((cur) => cur.filter((i) => i.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    setItems((cur) => [...cur, { ...input, id }]);
    timers.current.set(id, setTimeout(() => dismiss(id), input.action ? ACTION_DISMISS_MS : DISMISS_MS));
  }, [dismiss]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach(clearTimeout);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((i) => (
          <div key={i.id} className={`pointer-events-auto flex items-center gap-3 rounded-lg border bg-surface-raised px-4 py-3 text-sm text-foreground shadow-lg ${tones[i.tone ?? "neutral"]}`}>
            <span>{i.message}</span>
            {i.action && (
              <button
                type="button"
                onClick={() => {
                  i.action?.onClick();
                  dismiss(i.id);
                }}
                className="rounded-md px-2 py-1 text-xs-plus font-bold text-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {i.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
