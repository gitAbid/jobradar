import { getDb, rowToBoard } from "@/db";
import { fetchBoardListings } from "@/lib/adapters";
import { sanitizeTags } from "@/lib/adapters/normalize";
import { buildSearchText } from "@/lib/filters";
import { extractSkills } from "@/lib/skills";
import type { Board, NormalizedListing } from "@/lib/types";

export interface BoardRefreshOutcome {
  boardId: number;
  boardName: string;
  ok: boolean;
  fetched: number;
  inserted: number;
  error?: string;
}

export interface RefreshSummary {
  ranAt: string;
  results: BoardRefreshOutcome[];
  totalInserted: number;
}

/**
 * Fetch every enabled board (or just one), upsert listings, update health.
 * One failing board never blocks the others.
 */
export async function refreshAll(boardId?: number): Promise<RefreshSummary> {
  const db = getDb();
  const boards = (
    db
      .prepare(
        `SELECT b.* FROM boards b
         WHERE (? IS NULL OR b.id = ?) AND b.enabled = 1`,
      )
      .all(boardId ?? null, boardId ?? null) as Record<string, unknown>[]
  ).map((r) => rowToBoard(r as never));

  // fetch boards concurrently; node:sqlite writes are synchronous and thus
  // serialized by the event loop, so this is safe
  const results = await Promise.all(boards.map((board) => refreshBoard(board)));

  expireOldListings();

  return {
    ranAt: new Date().toISOString(),
    results,
    totalInserted: results.reduce((n, r) => n + r.inserted, 0),
  };
}

export async function refreshBoard(
  board: Pick<Board, "id" | "name" | "type" | "url" | "filterKeywords">,
): Promise<BoardRefreshOutcome> {
  const db = getDb();
  try {
    const listings = sanitizeTags(await fetchBoardListings(board));
    const inserted = upsertListings(board.id, listings);
    const now = new Date().toISOString();
    db.prepare("UPDATE boards SET last_fetched_at = ?, last_status = ? WHERE id = ?").run(
      now,
      `ok · ${listings.length} fetched`,
      board.id,
    );
    return { boardId: board.id, boardName: board.name, ok: true, fetched: listings.length, inserted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare("UPDATE boards SET last_fetched_at = ?, last_status = ? WHERE id = ?").run(
      new Date().toISOString(),
      `error · ${msg.slice(0, 180)}`,
      board.id,
    );
    return { boardId: board.id, boardName: board.name, ok: false, fetched: 0, inserted: 0, error: msg };
  }
}

function upsertListings(boardId: number, listings: NormalizedListing[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO listings (
      board_id, external_id, title, company, location,
      is_remote, visa_sponsorship, remote_scope, tags, skills, url, posted_at,
      fetched_at, status, user_tags, search_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '[]', ?)
    ON CONFLICT (board_id, external_id) DO NOTHING
  `);
  let inserted = 0;
  for (const l of listings) {
    if (!l.title || !l.url) continue; // skip malformed entries
    const skills = extractSkills({ title: l.title, tags: l.tags, description: l.description });
    const res = stmt.run(
      boardId,
      l.externalId,
      l.title,
      l.company,
      l.location,
      l.isRemote ? 1 : 0,
      l.visaSponsorship ? 1 : 0,
      l.remoteScope ?? null,
      JSON.stringify(l.tags),
      JSON.stringify(skills),
      l.url,
      l.postedAt,
      new Date().toISOString(),
      buildSearchText({
        title: l.title,
        company: l.company,
        location: l.location,
        tags: l.tags,
        description: l.description,
      }),
    );
    inserted += Number(res.changes);
  }
  return inserted;
}

/** Remove non-saved listings not refetched in 45 days (applied/favorite are kept). */
function expireOldListings(): void {
  const db = getDb();
  db.prepare(`
    DELETE FROM listings
    WHERE status = 'new'
      AND fetched_at < datetime('now', '-45 days')
  `).run();
}
