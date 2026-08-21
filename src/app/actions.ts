"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDb, rowToBoard } from "@/db";
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

  const db = getDb();
  try {
    db.prepare(
      "INSERT INTO boards (name, type, url, filter_keywords) VALUES (?, ?, ?, ?)",
    ).run(name, type, url, JSON.stringify(keywords));
  } catch {
    return; // duplicate name — silently ignore for now
  }
  revalidateAll();
}

export async function updateBoardKeywordsAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  getDb()
    .prepare("UPDATE boards SET filter_keywords = ? WHERE id = ?")
    .run(JSON.stringify(parseKeywords(formData.get("keywords"))), id);
  revalidateAll();
}

export async function toggleBoardEnabledAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  getDb()
    .prepare("UPDATE boards SET enabled = CASE enabled WHEN 1 THEN 0 ELSE 1 END WHERE id = ?")
    .run(id);
  revalidateAll();
}

export async function deleteBoardAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  getDb().prepare("DELETE FROM boards WHERE id = ?").run(id); // cascades to listings
  revalidateAll();
}

/** Dry-run fetch used by the "Test" button on the boards page. */
export async function testBoardAction(
  boardId: number,
): Promise<{ ok: boolean; message: string }> {
  const row = getDb().prepare("SELECT * FROM boards WHERE id = ?").get(boardId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return { ok: false, message: "Board not found" };
  const board = rowToBoard(row as never);
  const outcome = await refreshBoard(board);
  revalidateAll();
  return outcome.ok
    ? { ok: true, message: `✅ Fetched ${outcome.fetched} listings (${outcome.inserted} new)` }
    : { ok: false, message: `❌ ${outcome.error ?? "Unknown error"}` };
}

// ── Listing status & tags ──────────────────────────────────────────────────

export async function setListingStatusAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const status = String(formData.get("status"));
  const allowed = ["new", "favorite", "applied", "hidden"] as const;
  if (!Number.isInteger(id) || !allowed.includes(status as (typeof allowed)[number])) return;
  getDb().prepare("UPDATE listings SET status = ? WHERE id = ?").run(status, id);
  revalidateAll();
}

export async function addUserTagAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const tag = String(formData.get("tag") ?? "").trim().slice(0, 40);
  if (!Number.isInteger(id) || !tag) return;
  const row = getDb().prepare("SELECT user_tags FROM listings WHERE id = ?").get(id) as
    | { user_tags: string }
    | undefined;
  if (!row) return;
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.user_tags);
  } catch {
    tags = [];
  }
  if (!tags.includes(tag)) tags.push(tag);
  getDb().prepare("UPDATE listings SET user_tags = ? WHERE id = ?").run(JSON.stringify(tags), id);
  revalidateAll();
}

export async function removeUserTagAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const tag = String(formData.get("tag") ?? "");
  if (!Number.isInteger(id) || !tag) return;
  const row = getDb().prepare("SELECT user_tags FROM listings WHERE id = ?").get(id) as
    | { user_tags: string }
    | undefined;
  if (!row) return;
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.user_tags);
  } catch {
    tags = [];
  }
  getDb()
    .prepare("UPDATE listings SET user_tags = ? WHERE id = ?")
    .run(JSON.stringify(tags.filter((t) => t !== tag)), id);
  revalidateAll();
}

// ── Settings ───────────────────────────────────────────────────────────────

export async function saveSettingsAction(formData: FormData): Promise<void> {
  setGlobalKeywords(parseKeywords(formData.get("global_keywords")));
  const hours = Number(formData.get("interval_hours"));
  if (Number.isFinite(hours) && hours >= 1) {
    setSetting("refresh_interval_hours", String(Math.floor(hours)));
  }
  setSetting("sound_enabled", formData.get("sound_enabled") === "on" ? "true" : "false");
  revalidateAll();
}
