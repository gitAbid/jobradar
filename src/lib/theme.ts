export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "jobradar-theme";

export function parseTheme(v: string | null | undefined): Theme {
  return (THEMES as readonly string[]).includes(v ?? "") ? (v as Theme) : "system";
}

/** Runs in <head> before first paint: apply the last-known theme without a flash. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/** Apply + remember a theme on this device (client only). */
export function applyTheme(theme: Theme): void {
  const el = document.documentElement;
  try {
    if (theme === "system") {
      delete el.dataset.theme;
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      el.dataset.theme = theme;
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    /* storage blocked: the attribute still applies for this page view */
  }
}
