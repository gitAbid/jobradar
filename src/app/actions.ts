"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { qOne, rowToBoard, run } from "@/db";
import { setGlobalKeywords, setSetting, setUserSetting } from "@/lib/settings";
import { refreshBoard } from "@/lib/refresh";
import { AuthError, requireAdmin, requireUser, type SessionUser } from "@/lib/authz";

// ── Validation ─────────────────────────────────────────────────────────────

const boardSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(["api", "rss"]),
  url: z.url({ protocol: /^https?$/ }),
  keywords: z.array(z.string().max(60)).max(20).default([]),
});

function parseKeywords(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/boards");
  revalidatePath("/applied");
  revalidatePath("/following");
  // listings, boards and status all feed the shared cache
  updateTag("listings");
}

/** Writes already landed in Neon; just refresh the cached views. */
function commit() {
  revalidateAll();
}

/** A user's own listing state changed: refresh pages + only that user's cached feeds. */
function commitUserState(userId: string) {
  revalidatePath("/");
  revalidatePath("/applied");
  revalidatePath("/following");
  revalidatePath("/bangladesh");
  updateTag(`user-state:${userId}`);
}

type Gate = { ok: true; user: SessionUser } | { ok: false; status: 401 | 403 };

/**
 * Auth gate for every action. Failures map to each action's own error
 * convention (silent no-op for void actions, a generic message otherwise);
 * nothing about the failure is leaked. Anything but an AuthError is a bug and
 * propagates.
 */
async function gate(admin = false): Promise<Gate> {
  try {
    return { ok: true, user: await (admin ? requireAdmin() : requireUser()) };
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, status: err.status };
    throw err;
  }
}

// ── Boards CRUD ────────────────────────────────────────────────────────────

export async function addBoardAction(formData: FormData): Promise<void> {
  if (!(await gate(true)).ok) return;
  const parsed = boardSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    url: formData.get("url"),
    keywords: parseKeywords(formData.get("keywords")),
  });
  if (!parsed.success) return;
  const { name, type, url, keywords } = parsed.data;

  try {
    await run(
      "insert into boards (name, type, url, filter_keywords) values ($1, $2, $3, $4::text::jsonb)",
      [name, type, url, JSON.stringify(keywords)],
    );
  } catch {
    return; // duplicate name — silently ignore for now
  }
  await commit();
}

export async function updateBoardKeywordsAction(formData: FormData): Promise<void> {
  if (!(await gate(true)).ok) return;
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await run("update boards set filter_keywords = $1::text::jsonb where id = $2", [
    JSON.stringify(parseKeywords(formData.get("keywords"))),
    id,
  ]);
  await commit();
}

export async function toggleBoardEnabledAction(formData: FormData): Promise<void> {
  if (!(await gate(true)).ok) return;
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await run(
    "update boards set enabled = not enabled where id = $1",
    [id],
  );
  await commit();
}

export async function deleteBoardAction(formData: FormData): Promise<void> {
  if (!(await gate(true)).ok) return;
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await run("delete from boards where id = $1", [id]); // cascades to listings
  await commit();
}

/** Dry-run fetch used by the "Test" button on the boards page. */
export async function testBoardAction(
  boardId: number,
): Promise<{ ok: boolean; message: string }> {
  const g = await gate(true);
  if (!g.ok) {
    return { ok: false, message: g.status === 401 ? "Sign in required" : "Not allowed" };
  }
  const row = await qOne<Record<string, unknown>>("select * from boards where id = $1", [
    boardId,
  ]);
  if (!row) return { ok: false, message: "Board not found" };
  const board = rowToBoard(row as never);
  const outcome = await refreshBoard(board);
  await commit();
  return outcome.ok
    ? { ok: true, message: `OK · Fetched ${outcome.fetched} listings (${outcome.inserted} new)` }
    : { ok: false, message: `Failed · ${outcome.error ?? "Unknown error"}` };
}

// ── Listing status & tags (per user: user_listing_state) ───────────────────

/** Drop a state row that is back to defaults (status 'new', no tags). */
async function pruneDefaultState(userId: string, listingId: number): Promise<void> {
  await run(
    `delete from user_listing_state
      where user_id = $1::uuid and listing_id = $2::int
        and status = 'new' and user_tags = '[]'::jsonb`,
    [userId, listingId],
  );
}

export async function setListingStatusAction(formData: FormData): Promise<void> {
  const g = await gate();
  if (!g.ok) return;
  const id = Number(formData.get("id"));
  const status = String(formData.get("status"));
  const allowed = ["new", "favorite", "applied", "hidden"] as const;
  if (!Number.isInteger(id) || !allowed.includes(status as (typeof allowed)[number])) return;
  await run(
    `insert into user_listing_state (user_id, listing_id, status)
     select $1::uuid, l.id, $3::text from listings l where l.id = $2::int
     on conflict (user_id, listing_id)
     do update set status = excluded.status, updated_at = now()`,
    [g.user.id, id, status],
  );
  await pruneDefaultState(g.user.id, id);
  commitUserState(g.user.id);
}

export async function addUserTagAction(formData: FormData): Promise<void> {
  const g = await gate();
  if (!g.ok) return;
  const id = Number(formData.get("id"));
  const tag = String(formData.get("tag") ?? "").trim().slice(0, 40);
  if (!Number.isInteger(id) || !tag) return;
  await run(
    `insert into user_listing_state (user_id, listing_id, user_tags)
     select $1::uuid, l.id, jsonb_build_array($3::text) from listings l where l.id = $2::int
     on conflict (user_id, listing_id)
     do update set user_tags = case
         when user_listing_state.user_tags @> jsonb_build_array($3::text) then user_listing_state.user_tags
         else user_listing_state.user_tags || jsonb_build_array($3::text) end,
       updated_at = now()`,
    [g.user.id, id, tag],
  );
  commitUserState(g.user.id);
}

export async function removeUserTagAction(formData: FormData): Promise<void> {
  const g = await gate();
  if (!g.ok) return;
  const id = Number(formData.get("id"));
  const tag = String(formData.get("tag") ?? "");
  if (!Number.isInteger(id) || !tag) return;
  await run(
    `update user_listing_state
        set user_tags = coalesce(
              (select jsonb_agg(t) from jsonb_array_elements(user_listing_state.user_tags) t
                where t <> to_jsonb($3::text)), '[]'::jsonb),
            updated_at = now()
      where user_id = $1::uuid and listing_id = $2::int`,
    [g.user.id, id, tag],
  );
  await pruneDefaultState(g.user.id, id);
  commitUserState(g.user.id);
}

// ── Followed companies ─────────────────────────────────────────────────────

/** Toggle follow state for a company (insert if absent, delete if present). */
export async function toggleFollowCompanyAction(formData: FormData): Promise<void> {
  const g = await gate();
  if (!g.ok) return;
  const name = String(formData.get("company") ?? "").trim().slice(0, 120);
  if (!name) return;
  const removed = await run(
    "delete from followed_companies where user_id = $1::uuid and lower(name) = lower($2)",
    [g.user.id, name],
  );
  if (removed === 0) {
    await run(
      `insert into followed_companies (user_id, name, created_at) values ($1::uuid, $2, now())
       on conflict (user_id, lower(name)) do nothing`,
      [g.user.id, name],
    );
  }
  commitUserState(g.user.id);
}

// ── Pinned countries ───────────────────────────────────────────────────────

/** Toggle pin state for a country (shown in the nav bar while pinned). */
export async function togglePinCountryAction(formData: FormData): Promise<void> {
  const g = await gate();
  if (!g.ok) return;
  const name = String(formData.get("country") ?? "").trim().slice(0, 60);
  if (!name) return;
  const removed = await run(
    "delete from pinned_countries where user_id = $1::uuid and lower(name) = lower($2)",
    [g.user.id, name],
  );
  if (removed === 0) {
    await run(
      `insert into pinned_countries (user_id, name, created_at) values ($1::uuid, $2, now())
       on conflict (user_id, lower(name)) do nothing`,
      [g.user.id, name],
    );
  }
  // layout renders the pinned-country nav on every route
  revalidatePath("/", "layout");
}

// ── Settings ───────────────────────────────────────────────────────────────

/** Keywords + sound are per user; the refresh interval is system-wide (admin only). */
export async function saveSettingsAction(formData: FormData): Promise<void> {
  const g = await gate();
  if (!g.ok) return;
  await setGlobalKeywords(g.user.id, parseKeywords(formData.get("global_keywords")));
  await setUserSetting(g.user.id, "sound_enabled", formData.get("sound_enabled") === "on" ? "true" : "false");

  const hours = Number(formData.get("interval_hours"));
  if (g.user.role === "admin" && Number.isFinite(hours) && hours >= 1) {
    await setSetting("refresh_interval_hours", String(Math.floor(hours)));
  }
  commitUserState(g.user.id);
  revalidatePath("/boards");
}
