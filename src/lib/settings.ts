import { qOne, run } from "@/db";

export async function getSetting(key: string): Promise<string | null> {
  const row = await qOne<{ value: string }>(
    "select value from app_settings where key = $1",
    [key],
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await run(
    "insert into app_settings (key, value) values ($1, $2) " +
      "on conflict (key) do update set value = excluded.value",
    [key, value],
  );
}

/** Global skill keywords, e.g. ["java","spring boot","senior","lead"] */
export async function getGlobalKeywords(): Promise<string[]> {
  const raw = await getSetting("global_keywords");
  if (!raw) return ["java", "spring boot", "senior", "lead"]; // defaults for Abid
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function setGlobalKeywords(keywords: string[]): Promise<void> {
  await setSetting("global_keywords", JSON.stringify(keywords));
}

export async function getRefreshIntervalHours(): Promise<number> {
  const raw = await getSetting("refresh_interval_hours");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : 4;
}

export async function isSoundEnabled(): Promise<boolean> {
  return (await getSetting("sound_enabled")) !== "false";
}
