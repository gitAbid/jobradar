"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { qOne, rowToBoard, run } from "@/db";
import { setGlobalKeywords, setSetting, setUserSetting } from "@/lib/settings";
import { refreshBoard } from "@/lib/refresh";
import { THEMES } from "@/lib/theme";
import { gateAction } from "@/lib/authz";

// ── Validation ─────────────────────────────────────────────────────────────

const boardSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(["api", "rss"]),
  url: z.url({ protocol: /^https?$/ }),
  keywords: z.array(z.string().max(60)).max(20).default([]),
});

const FIELD_MESSAGES: Record<string, string> = {
  name: "Enter a name (up to 80 characters).",
  type: "Pick API or RSS.",
  url: "Enter a valid http(s) URL.",
  keywords: "Up to 20 keywords, 60 characters each.",
};

function parseKeywords(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Result of every server action in this file; `fieldErrors` keys are form field names. */
export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const OK: ActionResult = { ok: true };
const fail = (error: string, fieldErrors?: Record<string, string>): ActionResult => ({
  ok: false,
  error,
  ...(fieldErrors ? { fieldErrors } : {}),
});

/** Every route that renders listings or board data. */
const LISTING_ROUTES = ["/", "/saved", "/following"] as const;

function revalidateAll() {
  for (const p of LISTING_ROUTES) revalidatePath(p);
  revalidatePath("/admin/boards");
  // listings, boards and status all feed the shared cache
  updateTag("listings");
}

/** Writes already landed in Neon; just refresh the cached views. */
function commit() {
  revalidateAll();
}

/** A user's own listing state changed: refresh pages + only that user's cached feeds. */
function commitUserState(userId: string) {
  for (const p of LISTING_ROUTES) revalidatePath(p);
  updateTag(`user-state:${userId}`);
}

/** Map a failed gate onto this file's ActionResult. */
function denied(g: { message: string }): ActionResult {
  return fail(g.message);
}

// ── Boards CRUD ────────────────────────────────────────────────────────────

export async function addBoardAction(formData: FormData): Promise<ActionResult> {
  const g = await gateAction("admin");
  if (!g.ok) return denied(g);
  const parsed = boardSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    url: formData.get("url"),
    keywords: parseKeywords(formData.get("keywords")),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = FIELD_MESSAGES[key] ?? issue.message;
    }
    return fail("Check the highlighted fields.", fieldErrors);
  }
  const { name, type, url, keywords } = parsed.data;

  try {
    await run(
      "insert into boards (name, type, url, filter_keywords) values ($1, $2, $3, $4::text::jsonb)",
      [name, type, url, JSON.stringify(keywords)],
    );
  } catch (err) {
    if ((err as { code?: string } | null)?.code === "23505") {
      return fail("A board with that name already exists.", { name: "A board with that name already exists." });
    }
    console.error("[jobradar] add board failed:", err);
    return fail("Couldn’t add the board — try again shortly.");
  }
  await commit();
  return OK;
}

export async function updateBoardKeywordsAction(formData: FormData): Promise<ActionResult> {
  const g = await gateAction("admin");
  if (!g.ok) return denied(g);
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return fail("Invalid board.");
  await run("update boards set filter_keywords = $1::text::jsonb where id = $2", [
    JSON.stringify(parseKeywords(formData.get("keywords"))),
    id,
  ]);
  await commit();
  return OK;
}

export async function toggleBoardEnabledAction(formData: FormData): Promise<ActionResult> {
  const g = await gateAction("admin");
  if (!g.ok) return denied(g);
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return fail("Invalid board.");
  await run(
    "update boards set enabled = not enabled where id = $1",
    [id],
  );
  await commit();
  return OK;
}

export async function deleteBoardAction(formData: FormData): Promise<ActionResult> {
  const g = await gateAction("admin");
  if (!g.ok) return denied(g);
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return fail("Invalid board.");
  await run("delete from boards where id = $1", [id]); // cascades to listings
  await commit();
  return OK;
}

/** Dry-run fetch used by the "Test" button on the boards page. */
export async function testBoardAction(
  boardId: number,
): Promise<{ ok: boolean; message: string }> {
  const g = await gateAction("admin");
  if (!g.ok) return { ok: false, message: g.message };
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

export async function setListingStatusAction(formData: FormData): Promise<ActionResult> {
  const g = await gateAction();
  if (!g.ok) return denied(g);
  const id = Number(formData.get("id"));
  const status = String(formData.get("status"));
  const allowed = ["new", "favorite", "applied", "hidden"] as const;
  if (!Number.isInteger(id) || !allowed.includes(status as (typeof allowed)[number])) {
    return fail("Invalid listing or status.");
  }
  await run(
    `insert into user_listing_state (user_id, listing_id, status)
     select $1::uuid, l.id, $3::text from listings l where l.id = $2::int
     on conflict (user_id, listing_id)
     do update set status = excluded.status, updated_at = now()`,
    [g.user.id, id, status],
  );
  await pruneDefaultState(g.user.id, id);
  commitUserState(g.user.id);
  return OK;
}

export async function addUserTagAction(formData: FormData): Promise<ActionResult> {
  const g = await gateAction();
  if (!g.ok) return denied(g);
  const id = Number(formData.get("id"));
  const tag = String(formData.get("tag") ?? "").trim().slice(0, 40);
  if (!Number.isInteger(id) || !tag) return fail("Enter a tag.");
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
  return OK;
}

export async function removeUserTagAction(formData: FormData): Promise<ActionResult> {
  const g = await gateAction();
  if (!g.ok) return denied(g);
  const id = Number(formData.get("id"));
  const tag = String(formData.get("tag") ?? "");
  if (!Number.isInteger(id) || !tag) return fail("Invalid tag.");
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
  return OK;
}

// ── Followed companies ─────────────────────────────────────────────────────

/** Toggle follow state for a company (insert if absent, delete if present). */
export async function toggleFollowCompanyAction(formData: FormData): Promise<ActionResult> {
  const g = await gateAction();
  if (!g.ok) return denied(g);
  const name = String(formData.get("company") ?? "").trim().slice(0, 120);
  if (!name) return fail("Invalid company.");
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
  return OK;
}

// ── Pinned countries ───────────────────────────────────────────────────────

/** Toggle pin state for a country (shown in the nav bar while pinned). */
export async function togglePinCountryAction(formData: FormData): Promise<ActionResult> {
  const g = await gateAction();
  if (!g.ok) return denied(g);
  const name = String(formData.get("country") ?? "").trim().slice(0, 60);
  if (!name) return fail("Invalid country.");
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
  return OK;
}

// ── Settings ───────────────────────────────────────────────────────────────

/**
 * Keywords + sound are per user (written only when the preferences form
 * submitted them); the refresh interval is system-wide (admin only).
 */
export async function saveSettingsAction(formData: FormData): Promise<ActionResult> {
  const g = await gateAction();
  if (!g.ok) return denied(g);
  if (formData.has("global_keywords")) {
    await setGlobalKeywords(g.user.id, parseKeywords(formData.get("global_keywords")));
    await setUserSetting(g.user.id, "sound_enabled", formData.get("sound_enabled") === "on" ? "true" : "false");
  }

  const hours = Number(formData.get("interval_hours"));
  if (g.user.role === "admin" && Number.isFinite(hours) && hours >= 1) {
    await setSetting("refresh_interval_hours", String(Math.floor(hours)));
  }
  commitUserState(g.user.id);
  revalidatePath("/settings");
  revalidatePath("/admin/boards");
  return OK;
}

/** Per-user colour theme: "system" follows the OS, otherwise forced light/dark. */
export async function saveThemeAction(formData: FormData): Promise<ActionResult> {
  const g = await gateAction();
  if (!g.ok) return denied(g);
  const theme = z.enum(THEMES).safeParse(formData.get("theme"));
  if (!theme.success) return fail("Pick system, light or dark.");
  await setUserSetting(g.user.id, "theme", theme.data);
  revalidatePath("/settings");
  return OK;
}
