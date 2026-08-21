import { getDb } from "@/db";

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

/** Global skill keywords, e.g. ["java","spring boot","senior","lead"] */
export function getGlobalKeywords(): string[] {
  const raw = getSetting("global_keywords");
  if (!raw) return ["java", "spring boot", "senior", "lead"]; // defaults for Abid
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function setGlobalKeywords(keywords: string[]): void {
  setSetting("global_keywords", JSON.stringify(keywords));
}

export function getRefreshIntervalHours(): number {
  const raw = getSetting("refresh_interval_hours");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : 4;
}

export function isSoundEnabled(): boolean {
  return getSetting("sound_enabled") !== "false";
}
