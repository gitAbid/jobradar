import { cache } from "react";
import { qOne } from "@/db";
import { parseGlobalKeywords, parseSoundEnabled, parseTheme } from "@/lib/settings";

/**
 * Everything the layout and pages read about the signed-in user, in ONE round
 * trip: settings, pinned countries, followed companies and the onboarding
 * signal. Wrapped in React `cache()`, so the header, the refresh bar and the
 * page share a single query per request. Request-scoped only — never reused
 * across requests, so there is nothing to invalidate.
 */
export interface UserContext {
  settings: Map<string, string>;
  /** alphabetical (case-insensitive), as `listPinnedCountries` */
  pinnedCountries: string[];
  /** alphabetical (case-insensitive), as `listFollowedCompanies` */
  followedCompanies: string[];
  hasListingState: boolean;
}

export async function loadUserContext(userId: string): Promise<UserContext> {
  const row = await qOne<{
    settings: unknown;
    pinned: unknown;
    followed: unknown;
    has_state: boolean;
  }>(
    `select
       (select jsonb_object_agg(key, value) from user_settings where user_id = $1::uuid) as settings,
       (select jsonb_agg(name order by lower(name)) from pinned_countries where user_id = $1::uuid) as pinned,
       (select jsonb_agg(name order by lower(name)) from followed_companies where user_id = $1::uuid) as followed,
       exists (select 1 from user_listing_state where user_id = $1::uuid) as has_state`,
    [userId],
  );
  const settings = asObject(row?.settings);
  return {
    settings: new Map(Object.entries(settings).map(([k, v]) => [k, String(v)])),
    pinnedCountries: asStringArray(row?.pinned),
    followedCompanies: asStringArray(row?.followed),
    hasListingState: row?.has_state === true,
  };
}

export const getUserContext = cache(loadUserContext);

/** Mirrors `needsOnboarding`: no state of any kind yet. */
export function contextNeedsOnboarding(ctx: UserContext): boolean {
  return (
    ctx.settings.size === 0 &&
    ctx.pinnedCountries.length === 0 &&
    ctx.followedCompanies.length === 0 &&
    !ctx.hasListingState
  );
}

export function contextGlobalKeywords(ctx: UserContext): string[] {
  return parseGlobalKeywords(ctx.settings.get("global_keywords"));
}

export function contextSoundEnabled(ctx: UserContext): boolean {
  return parseSoundEnabled(ctx.settings.get("sound_enabled"));
}

export function contextTheme(ctx: UserContext): "system" | "light" | "dark" {
  return parseTheme(ctx.settings.get("theme"));
}

// jsonb arrives parsed (postgres.js / PGlite); tolerate JSON text too.
function asJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function asObject(v: unknown): Record<string, unknown> {
  const o = asJson(v);
  return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
}

function asStringArray(v: unknown): string[] {
  const a = asJson(v);
  return Array.isArray(a) ? a.map(String) : [];
}
