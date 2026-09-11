"use client";

import { useActionState, useState } from "react";
import { createApiKeyAction, type CreateKeyState } from "@/app/api-keys/actions";
import { CopyButton } from "@/components/CopyButton";

const INITIAL: CreateKeyState = {};

export function CreateKeyForm() {
  const [state, formAction, pending] = useActionState(createApiKeyAction, INITIAL);
  const [dismissed, setDismissed] = useState(false);
  const showSecret = Boolean(state.plaintext) && !dismissed;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="min-w-48 flex-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            Key name
          </span>
          <input
            name="name"
            required
            maxLength={80}
            placeholder="my-app"
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>

      {state.error && <p className="mt-3 text-sm font-medium text-red-600">{state.error}</p>}

      {showSecret && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            Copy your new API key now — it won’t be shown again.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-xs text-slate-800">
              {state.plaintext}
            </code>
            <CopyButton text={state.plaintext ?? ""} />
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
