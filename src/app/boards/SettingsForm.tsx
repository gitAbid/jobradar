"use client";

import { Settings2 } from "lucide-react";
import { saveSettingsAction } from "@/app/actions";
import { useToastedAction } from "@/components/use-toasted-action";
import { Button } from "@/components/ui";

export function SettingsForm({
  intervalHours,
  keywords,
  sound,
}: {
  intervalHours: number;
  keywords: string[];
  sound: boolean;
}) {
  const [, action, pending] = useToastedAction(saveSettingsAction, { success: "Settings saved" });
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgb(15_42_67/0.05)] sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><Settings2 className="h-5 w-5" /></span>
        <div>
          <h2 className="text-sm font-bold text-slate-900">Radar preferences</h2>
          <p className="mt-0.5 text-xs text-slate-500">Set the matching vocabulary and how often your sources refresh.</p>
        </div>
      </div>
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-slate-600">
          Global skill keywords
          <input name="global_keywords" defaultValue={keywords.join(", ")} className="field-input" />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-slate-600">
          Refresh interval (hours)
          <input name="interval_hours" type="number" min={1} max={48} defaultValue={intervalHours} className="field-input w-full sm:w-28" />
        </label>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:border-violet-300">
          <input type="checkbox" name="sound_enabled" defaultChecked={sound} className="h-4 w-4 accent-violet-600" />
          Sound ping
        </label>
        <Button type="submit" pending={pending}>Save settings</Button>
      </form>
    </section>
  );
}
