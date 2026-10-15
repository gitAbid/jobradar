"use client";

import { Plus } from "lucide-react";
import { addBoardAction } from "@/app/actions";
import { useToastedAction } from "@/components/use-toasted-action";
import { Button } from "@/components/ui";

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-muted">
      {label}
      {children}
      {error && <span role="alert" className="text-xs font-semibold text-danger">{error}</span>}
    </label>
  );
}

export function AddBoardForm() {
  const [state, action, pending] = useToastedAction(addBoardAction, { success: "Board added" });
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const invalid = (k: string) => (errors[k] ? true : undefined);

  return (
    <form
      action={action}
      className="rounded-2xl border border-border bg-surface-raised p-4 shadow-[0_10px_28px_rgb(15_42_67/0.05)] sm:p-5"
    >
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-soft text-teal-ink">
          <Plus className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-sm font-bold text-foreground">Add a job board</h2>
          <p className="mt-0.5 text-xs text-muted">API boards return JSON; RSS boards accept any RSS or Atom feed URL.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_0.8fr_1.5fr_1.2fr_auto] lg:items-start">
        <Field label="Name" error={errors.name}>
          <input name="name" required maxLength={80} placeholder="My board" aria-invalid={invalid("name")} className="field-input" />
        </Field>
        <Field label="Type" error={errors.type}>
          <select name="type" aria-invalid={invalid("type")} className="field-input">
            <option value="api">API (JSON)</option>
            <option value="rss">RSS / Atom</option>
          </select>
        </Field>
        <Field label="URL" error={errors.url}>
          <input name="url" type="url" required placeholder="https://example.com/api" aria-invalid={invalid("url")} className="field-input" />
        </Field>
        <Field label="Extra keywords" error={errors.keywords}>
          <input name="keywords" placeholder="visa sponsorship, bangladesh" aria-invalid={invalid("keywords")} className="field-input" />
        </Field>
        <Button type="submit" pending={pending} className="lg:mt-[1.375rem]">
          <Plus className="h-4 w-4" /> Add board
        </Button>
      </div>
    </form>
  );
}
