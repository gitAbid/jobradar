"use client";

import { useState } from "react";
import { saveThemeAction } from "@/app/actions";
import { useToastedAction } from "@/components/use-toasted-action";
import { Button } from "@/components/ui";
import { applyTheme, THEMES, type Theme } from "@/lib/theme";

const LABELS: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

/** Theme picker: previews instantly on this device, persisted per user on save. */
export function ThemeForm({ theme }: { theme: Theme }) {
  const [value, setValue] = useState<Theme>(theme);
  const [, action, pending] = useToastedAction(saveThemeAction, { success: "Theme saved" });
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Theme</legend>
        {THEMES.map((t) => (
          <label
            key={t}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium text-muted hover:border-violet-line has-[:checked]:border-violet-line has-[:checked]:bg-violet-soft"
          >
            <input
              type="radio"
              name="theme"
              value={t}
              checked={value === t}
              onChange={() => {
                setValue(t);
                applyTheme(t);
              }}
              className="h-4 w-4 accent-violet-600"
            />
            {LABELS[t]}
          </label>
        ))}
      </fieldset>
      <Button type="submit" pending={pending}>Save theme</Button>
    </form>
  );
}
