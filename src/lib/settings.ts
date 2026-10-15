import { qOne, run } from "@/db";

// ── System settings (app_settings): refresh interval, run/lock, markers ────

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

export async function getRefreshIntervalHours(): Promise<number> {
  const raw = await getSetting("refresh_interval_hours");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : 4;
}

// ── Per-user preferences (user_settings) ───────────────────────────────────

export async function getUserSetting(userId: string, key: string): Promise<string | null> {
  const row = await qOne<{ value: string }>(
    "select value from user_settings where user_id = $1::uuid and key = $2",
    [userId, key],
  );
  return row?.value ?? null;
}

export async function setUserSetting(userId: string, key: string, value: string): Promise<void> {
  await run(
    "insert into user_settings (user_id, key, value) values ($1::uuid, $2, $3) " +
      "on conflict (user_id, key) do update set value = excluded.value, updated_at = now()",
    [userId, key, value],
  );
}

// New users see the unfiltered feed until they pick keywords (onboarding, P5.7).
const DEFAULT_KEYWORDS: string[] = [];

/** The user's skill keywords, e.g. ["java","spring boot","senior","lead"] */
export async function getGlobalKeywords(userId: string): Promise<string[]> {
  const raw = await getUserSetting(userId, "global_keywords");
  if (!raw) return DEFAULT_KEYWORDS;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function setGlobalKeywords(userId: string, keywords: string[]): Promise<void> {
  await setUserSetting(userId, "global_keywords", JSON.stringify(keywords));
}

export async function isSoundEnabled(userId: string): Promise<boolean> {
  return (await getUserSetting(userId, "sound_enabled")) !== "false";
}

export async function getTheme(userId: string): Promise<"system" | "light" | "dark"> {
  const v = await getUserSetting(userId, "theme");
  return v === "light" || v === "dark" ? v : "system";
}

// ── Onboarding (P5.7) ──────────────────────────────────────────────────────

export const ONBOARDING_KEY = "onboarding_complete";

export async function markOnboardingComplete(userId: string): Promise<void> {
  await setUserSetting(userId, ONBOARDING_KEY, "true");
}

/**
 * True for a brand-new account: no completion marker and no prior state of any
 * kind (settings, pinned countries, follows, listing state). Existing users are
 * never forced through onboarding.
 */
export async function needsOnboarding(userId: string): Promise<boolean> {
  const row = await qOne<{ used: boolean }>(
    `select (
       exists (select 1 from user_settings where user_id = $1::uuid)
       or exists (select 1 from pinned_countries where user_id = $1::uuid)
       or exists (select 1 from followed_companies where user_id = $1::uuid)
       or exists (select 1 from user_listing_state where user_id = $1::uuid)
     ) as used`,
    [userId],
  );
  return !row?.used;
}
