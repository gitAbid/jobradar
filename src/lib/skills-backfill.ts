import { q, run } from "@/db";
import { getSetting, setSetting } from "@/lib/settings";
import { extractSkills } from "@/lib/skills";

/**
 * Re-run skill extraction over stored listings whose skills are empty,
 * using their persisted text (title + tags + description snippet).
 * Runs once per vocabulary version, guarded by app_settings.
 */
export const SKILLS_VERSION = "2";

export async function backfillSkillsIfNeeded(): Promise<void> {
  if ((await getSetting("skills_version")) === SKILLS_VERSION) return;

  const rows = await q<{ id: number; tags: string; search_text: string }>(
    `select id, tags, search_text from listings where skills = '[]'`,
  );

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
      await run(`update listings set skills = $1 where id = $2`, [JSON.stringify(skills), r.id]);
      filled++;
    }
  }

  await setSetting("skills_version", SKILLS_VERSION);
  console.log(
    `[jobradar] skills backfill v${SKILLS_VERSION}: ${filled}/${rows.length} empty listings enriched`,
  );
}
