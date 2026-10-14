"use client";

import { Settings2 } from "lucide-react";
import { saveSettingsAction } from "@/app/actions";
import { useToastedAction } from "@/components/use-toasted-action";
import { Button } from "@/components/ui";

/** System-wide refresh cadence (admin only; the action re-checks the role). */
export function SettingsForm({ intervalHours }: { intervalHours: number }) {
  const [, action, pending] = useToastedAction(saveSettingsAction, { success: "Refresh schedule saved" });
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgb(15_42_67/0.05)] sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><Settings2 className="h-5 w-5" /></span>
        <div>
          <h2 className="text-sm font-bold text-slate-900">Refresh schedule</h2>
          <p className="mt-0.5 text-xs text-slate-500">How often all sources refresh. Keywords and sound live in your own settings.</p>
        </div>
      </div>
      <form action={action} className="grid gap-3 sm:grid-cols-[auto_auto] sm:items-end">
        <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-slate-600">
          Refresh interval (hours)
          <input name="interval_hours" type="number" min={1} max={48} defaultValue={intervalHours} className="field-input w-full sm:w-28" />
        </label>
        <Button type="submit" pending={pending}>Save settings</Button>
      </form>
    </section>
  );
}
