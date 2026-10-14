import { BOT_UA, safeFetch } from "@/lib/safe-fetch";

/**
 * robots.txt (RFC 9309) support. One fetch per origin, cached in-module.
 * 4xx -> no restrictions; 5xx / network error -> treated as disallowed, but
 * only cached briefly so the origin is retried soon.
 */

const AGENT = "jobradarbot";
const TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const MAX_ORIGINS = 500;
const FETCH_TIMEOUT_MS = 10_000;

export class RobotsDisallowedError extends Error {
  constructor(public readonly url: string) {
    super(`blocked by robots.txt: ${url}`);
    this.name = "RobotsDisallowedError";
  }
}

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}
export interface RobotsRules {
  /** true => everything disallowed (robots.txt unreachable) */
  denyAll?: boolean;
  rules: RobotsRule[];
}

/** Parse robots.txt, returning the rules of the JobRadarBot group, else `*`. */
export function parseRobots(text: string): RobotsRules {
  const groups: Array<{ agents: string[]; rules: RobotsRule[] }> = [];
  let cur: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!cur) continue;
      // empty Disallow = allow all (no rule); empty Allow is a no-op too
      if (value) cur.rules.push({ allow: key === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a === AGENT));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  return { rules: chosen.flatMap((g) => g.rules) };
}

function patternToRegex(pattern: string): RegExp {
  let anchored = false;
  let p = pattern;
  if (p.endsWith("$")) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const body = p
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Longest matching pattern wins; Allow wins ties; no match = allowed. */
export function isPathAllowed(rules: RobotsRules, pathAndQuery: string): boolean {
  if (rules.denyAll) return false;
  let best: RobotsRule | null = null;
  for (const r of rules.rules) {
    if (!patternToRegex(r.pattern).test(pathAndQuery)) continue;
    if (
      !best ||
      r.pattern.length > best.pattern.length ||
      (r.pattern.length === best.pattern.length && r.allow && !best.allow)
    ) {
      best = r;
    }
  }
  return best ? best.allow : true;
}

const cache = new Map<string, { rules: RobotsRules; expires: number }>();

/** Test hook. */
export function clearRobotsCache(): void {
  cache.clear();
}

async function loadRules(origin: string): Promise<{ rules: RobotsRules; ttl: number }> {
  try {
    const res = await safeFetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": BOT_UA, Accept: "text/plain, */*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) return { rules: parseRobots(await res.text()), ttl: TTL_MS };
    if (res.status >= 400 && res.status < 500) return { rules: { rules: [] }, ttl: TTL_MS };
  } catch {
    // fall through: unreachable
  }
  return { rules: { denyAll: true, rules: [] }, ttl: FAILURE_TTL_MS };
}

export async function isAllowedByRobots(url: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const now = Date.now();
  let entry = cache.get(u.origin);
  if (!entry || entry.expires <= now) {
    const { rules, ttl } = await loadRules(u.origin);
    entry = { rules, expires: now + ttl };
    cache.delete(u.origin);
    if (cache.size >= MAX_ORIGINS) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(u.origin, entry);
  }
  return isPathAllowed(entry.rules, u.pathname + u.search);
}
