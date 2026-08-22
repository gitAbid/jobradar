import { getDb } from "@/db";
import { getSetting, setSetting } from "@/lib/settings";
import { extractSkills } from "@/lib/skills";

/**
 * Re-run skill extraction over stored listings whose skills are empty,
 * using their persisted text (title + tags + description snippet).
 * Runs once per vocabulary version, guarded by app_settings.
 */
export const SKILLS_VERSION = "2";

export function backfillSkillsIfNeeded(): void {
  if (getSetting("skills_version") === SKILLS_VERSION) return;

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, tags, search_text FROM listings WHERE skills = '[]'`,
    )
    .all() as Array<{ id: number; title: string; tags: string; search_text: string }>;

  const update = db.prepare(`UPDATE listings SET skills = ? WHERE id = ?`);
  let filled = 0;
  for (const r of rows) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(r.tags);
    } catch {
      tags = [];
    }
    // search_text already contains lowercased title+company+location+tags+description
    const skills = extractSkills({
      title: "",
      tags,
      description: r.search_text,
    });
    if (skills.length > 0) {
      update.run(JSON.stringify(skills), r.id);
      filled++;
    }
  }

  setSetting("skills_version", SKILLS_VERSION);
  console.log(
    `[jobradar] skills backfill v${SKILLS_VERSION}: ${filled}/${rows.length} empty listings enriched`,
  );
}
