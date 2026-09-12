"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { q, qOne, rowToBoard, run } from "@/db";
import { setGlobalKeywords, setSetting } from "@/lib/settings";
import { refreshBoard } from "@/lib/refresh";

// ── Validation ─────────────────────────────────────────────────────────────

const boardSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(["api", "rss"]),
  url: z.url(),
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
}

// ── Boards CRUD ────────────────────────────────────────────────────────────

export async function addBoardAction(formData: FormData): Promise<void> {
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
      "insert into boards (name, type, url, filter_keywords) values ($1, $2, $3, $4)",
      [name, type, url, JSON.stringify(keywords)],
    );
  } catch {
    return; // duplicate name — silently ignore for now
  }
  revalidateAll();
}

export async function updateBoardKeywordsAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await run("update boards set filter_keywords = $1 where id = $2", [
    JSON.stringify(parseKeywords(formData.get("keywords"))),
    id,
  ]);
  revalidateAll();
}

export async function toggleBoardEnabledAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await run(
    "update boards set enabled = case when enabled = 1 then 0 else 1 end where id = $1",
    [id],
  );
  revalidateAll();
}

export async function deleteBoardAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await run("delete from boards where id = $1", [id]); // cascades to listings
  revalidateAll();
}

/** Dry-run fetch used by the "Test" button on the boards page. */
export async function testBoardAction(
  boardId: number,
): Promise<{ ok: boolean; message: string }> {
  const row = await qOne<Record<string, unknown>>("select * from boards where id = $1", [
    boardId,
  ]);
  if (!row) return { ok: false, message: "Board not found" };
  const board = rowToBoard(row as never);
  const outcome = await refreshBoard(board);
  revalidateAll();
  return outcome.ok
    ? { ok: true, message: `OK · Fetched ${outcome.fetched} listings (${outcome.inserted} new)` }
    : { ok: false, message: `Failed · ${outcome.error ?? "Unknown error"}` };
}

// ── Listing status & tags ──────────────────────────────────────────────────

export async function setListingStatusAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const status = String(formData.get("status"));
  const allowed = ["new", "favorite", "applied", "hidden"] as const;
  if (!Number.isInteger(id) || !allowed.includes(status as (typeof allowed)[number])) return;
  await run("update listings set status = $1 where id = $2", [status, id]);
  revalidateAll();
}

export async function addUserTagAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const tag = String(formData.get("tag") ?? "").trim().slice(0, 40);
  if (!Number.isInteger(id) || !tag) return;
  const row = await qOne<{ user_tags: string }>(
    "select user_tags from listings where id = $1",
    [id],
  );
  if (!row) return;
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.user_tags);
  } catch {
    tags = [];
  }
  if (!tags.includes(tag)) tags.push(tag);
  await run("update listings set user_tags = $1 where id = $2", [JSON.stringify(tags), id]);
  revalidateAll();
}

export async function removeUserTagAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const tag = String(formData.get("tag") ?? "");
  if (!Number.isInteger(id) || !tag) return;
  const row = await qOne<{ user_tags: string }>(
    "select user_tags from listings where id = $1",
    [id],
  );
  if (!row) return;
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.user_tags);
  } catch {
    tags = [];
  }
  await run("update listings set user_tags = $1 where id = $2", [
    JSON.stringify(tags.filter((t) => t !== tag)),
    id,
  ]);
  revalidateAll();
}

// ── Followed companies ─────────────────────────────────────────────────────

/** Toggle follow state for a company (insert if absent, delete if present). */
export async function toggleFollowCompanyAction(formData: FormData): Promise<void> {
  const name = String(formData.get("company") ?? "").trim().slice(0, 120);
  if (!name) return;
  const exists = await qOne(
    "select 1 from followed_companies where lower(name) = lower($1)",
    [name],
  );
  if (exists) {
    await run("delete from followed_companies where lower(name) = lower($1)", [name]);
  } else {
    await run("insert into followed_companies (name, created_at) values ($1, $2)", [
      name,
      new Date().toISOString(),
    ]);
  }
  revalidateAll();
}

// ── Pinned countries ───────────────────────────────────────────────────────

/** Toggle pin state for a country (shown in the nav bar while pinned). */
export async function togglePinCountryAction(formData: FormData): Promise<void> {
  const name = String(formData.get("country") ?? "").trim().slice(0, 60);
  if (!name) return;
  const exists = await qOne("select 1 from pinned_countries where lower(name) = lower($1)", [
    name,
  ]);
  if (exists) {
    await run("delete from pinned_countries where lower(name) = lower($1)", [name]);
  } else {
    await run("insert into pinned_countries (name, created_at) values ($1, $2)", [
      name,
      new Date().toISOString(),
    ]);
  }
  // layout renders the pinned-country nav on every route
  revalidatePath("/", "layout");
}

// ── Settings ───────────────────────────────────────────────────────────────

export async function saveSettingsAction(formData: FormData): Promise<void> {
  await setGlobalKeywords(parseKeywords(formData.get("global_keywords")));
  const hours = Number(formData.get("interval_hours"));
  if (Number.isFinite(hours) && hours >= 1) {
    await setSetting("refresh_interval_hours", String(Math.floor(hours)));
  }
  await setSetting("sound_enabled", formData.get("sound_enabled") === "on" ? "true" : "false");
  revalidateAll();
}
