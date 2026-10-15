"use client";

import { useActionState } from "react";
import { useToast } from "@/components/ui";

/** Minimal shape shared by every server action result (see `ActionResult`). */
export type ResultLike = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Wrap a `(FormData) => Promise<ActionResult>` server action for `<form action>`:
 * `pending` drives the double-submit guard, errors surface as a toast, and the
 * last result is returned so forms can render per-field errors.
 */
export function useToastedAction<R extends ResultLike>(
  action: (formData: FormData) => Promise<R>,
  opts: { success?: string; onSuccess?: () => void } = {},
) {
  const toast = useToast();
  return useActionState<R | null, FormData>(async (_prev, formData) => {
    const res = await action(formData);
    if (res.ok) {
      if (opts.success) toast({ message: opts.success, tone: "success" });
      opts.onSuccess?.();
    } else {
      toast({ message: res.error, tone: "danger" });
    }
    return res;
  }, null);
}
