"use client";

import { saveSettingsAction } from "@/app/actions";
import { useToastedAction } from "@/components/use-toasted-action";
import { Button } from "@/components/ui";

/** Per-user matching keywords + sound ping. */
export function PreferencesForm({ keywords, sound }: { keywords: string[]; sound: boolean }) {
  const [, action, pending] = useToastedAction(saveSettingsAction, { success: "Preferences saved" });
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
      <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-slate-600">
        Skill keywords (comma separated)
        <input name="global_keywords" defaultValue={keywords.join(", ")} className="field-input" />
      </label>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:border-violet-300">
        <input type="checkbox" name="sound_enabled" defaultChecked={sound} className="h-4 w-4 accent-violet-600" />
        Sound ping
      </label>
      <Button type="submit" pending={pending}>Save</Button>
    </form>
  );
}
