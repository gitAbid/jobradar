import type { LocalStore } from "@/db/local-store";

/**
 * Outbox normalization: turn Postgres statements into replay-safe queue ops.
 *
 * Local and remote rows have independent autoincrement ids, so a statement
 * referencing a row by its local id can land on the wrong row when replayed
 * remotely. Every app write is therefore classified at enqueue time:
 * statements already keyed by a stable business key (settings key, company
 * name, api key hash, board id in a hydrated mirror) replay verbatim; the
 * rest are rewritten as ops carrying the natural key (board name, listing
 * (board, external_id), api key hash) and re-resolved against the remote
 * at drain time.
 */

export const LISTING_INSERT_COLUMNS = [
  "board_id",
  "external_id",
  "title",
  "company",
  "location",
  "is_remote",
  "visa_sponsorship",
  "remote_scope",
  "tags",
  "skills",
  "url",
  "posted_at",
  "deadline",
  "fetched_at",
  "search_text",
  "description",
] as const;

export type OutboxOp =
  | { kind: "sql"; sql: string; params: unknown[] }
  | { kind: "board-insert"; sql: string; params: unknown[]; name: string }
  | { kind: "board-update"; name: string; fields: Record<string, unknown> }
  | { kind: "board-delete"; name: string }
  | {
      kind: "listing-update";
      boardName: string;
      externalId: string;
      fields: Record<string, unknown>;
      onlyWhenUnenriched?: boolean;
    }
  | { kind: "listings-insert"; boardName: string; rows: Record<string, unknown>[] }
  | { kind: "api-key-update"; keyHash: string; fields: Record<string, unknown> };

const collapse = (sql: string) => sql.trim().replace(/\s+/g, " ");

function boardNameById(store: LocalStore, boardId: number): string | null {
  const row = store.select("select name from boards where id = ?", [boardId])[0];
  return row ? String(row.name) : null;
}

function parseSetFields(setClause: string, params: unknown[]): Record<string, unknown> | null {
  const fields: Record<string, unknown> = {};
  for (const pair of setClause.split(",")) {
    const m = /^\s*([a-z_]+)\s*=\s*\$(\d+)\s*$/i.exec(pair);
    if (!m) return null; // non-literal expression (e.g. col = col + 1)
    fields[m[1]] = params[Number(m[2]) - 1];
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

export function toOutboxOp(query: string, params: unknown[], store: LocalStore): OutboxOp {
  const sql = collapse(query);

  // ── board inserts ────────────────────────────────────────────────────────
  // addBoardAction is the only producer; name is the natural key
  const boardInsert = /^insert into boards \(([a-z_, ]+)\) values \(([\d$, ]+)\)$/i.exec(sql);
  if (boardInsert) {
    return { kind: "board-insert", sql, params, name: String(params[0]) };
  }

  // ── board updates / deletes by id ───────────────────────────────────────
  const boardUpdate = /^update boards set (.+) where id = \$(\d+)$/i.exec(sql);
  if (boardUpdate) {
    const id = Number(params[Number(boardUpdate[2]) - 1]);
    const name = Number.isInteger(id) ? boardNameById(store, id) : null;
    // the enable-toggle writes a CASE expression, not a param — capture the
    // flipped value from the local row instead of parsing the expression
    const toggle =
      /^update boards set enabled = case when enabled = 1 then 0 else 1 end where id = \$(\d+)$/i.exec(
        sql,
      );
    if (toggle && name !== null) {
      // the local write already applied the flip — its post-write value is
      // the truth the remote should land on
      const current = store.select("select enabled from boards where name = ?", [name])[0];
      return {
        kind: "board-update",
        name,
        fields: { enabled: Number(current?.enabled ?? 0) },
      };
    }
    const fields = parseSetFields(boardUpdate[1], params);
    if (fields && name !== null) return { kind: "board-update", name, fields };
  }

  const boardDelete = /^delete from boards where id = \$(\d+)$/i.exec(sql);
  if (boardDelete) {
    const id = Number(params[Number(boardDelete[1]) - 1]);
    const name = Number.isInteger(id) ? boardNameById(store, id) : null;
    if (name !== null) return { kind: "board-delete", name };
  }

  // ── listing updates by local row id → (board name, external_id) ─────────
  const listingById = /^update listings set (.+) where id = \$(\d+)$/i.exec(sql);
  if (listingById) {
    const id = Number(params[Number(listingById[2]) - 1]);
    const row = Number.isInteger(id)
      ? store.select(
            "select l.external_id, b.name as board_name from listings l join boards b on b.id = l.board_id where l.id = ?",
            [id],
          )[0]
      : undefined;
    const fields = parseSetFields(listingById[1], params);
    if (fields && row) {
      return {
        kind: "listing-update",
        boardName: String(row.board_name),
        externalId: String(row.external_id),
        fields,
      };
    }
  }

  // ── enrichment updates, already keyed by (board_id, external_id) ────────
  const enrich = /^update listings set (.+) where board_id = \$(\d+) and external_id = \$(\d+)( and skills = '\[\]')?$/i.exec(
    sql,
  );
  if (enrich) {
    const boardId = Number(params[Number(enrich[2]) - 1]);
    const name = Number.isInteger(boardId) ? boardNameById(store, boardId) : null;
    const fields = parseSetFields(enrich[1], params);
    if (fields && name !== null) {
      return {
        kind: "listing-update",
        boardName: name,
        externalId: String(params[Number(enrich[3]) - 1]),
        fields,
        onlyWhenUnenriched: Boolean(enrich[4]),
      };
    }
  }

  // ── bulk listing inserts → rows keyed by column name ────────────────────
  const listingInsert =
    /^insert into listings \(([a-z_, ]+)\) values (.+?) on conflict \(board_id, external_id\) do nothing$/i.exec(
      sql,
    );
  if (listingInsert) {
    const columns = listingInsert[1].split(",").map((c) => c.trim());
    const tupleMatch = /^\(([\d$, ]+)\)$/.exec(listingInsert[2]);
    if (
      tupleMatch &&
      columns.length === LISTING_INSERT_COLUMNS.length &&
      columns.every((c, i) => c === LISTING_INSERT_COLUMNS[i])
    ) {
      const placeholders = tupleMatch[1].split(",").map((p) => Number(p.trim().slice(1)));
      const boardId = Number(params[placeholders[0] - 1]);
      const name = Number.isInteger(boardId) ? boardNameById(store, boardId) : null;
      if (name !== null && placeholders.length % columns.length === 0) {
        const rowCount = placeholders.length / columns.length;
        const rows: Record<string, unknown>[] = [];
        for (let r = 0; r < rowCount; r += 1) {
          const row: Record<string, unknown> = {};
          columns.forEach((col, c) => {
            row[col] = params[placeholders[r * columns.length + c] - 1];
          });
          rows.push(row);
        }
        return { kind: "listings-insert", boardName: name, rows };
      }
    }
  }

  // ── api key stats/revoke by row id → keyed by key_hash ──────────────────
  const keyUsage =
    /^update api_keys set last_used_at = \$(\d+), request_count = request_count \+ 1 where id = \$(\d+)$/i.exec(
      sql,
    );
  if (keyUsage) {
    const id = Number(params[Number(keyUsage[2]) - 1]);
    const row = Number.isInteger(id)
      ? store.select("select key_hash, request_count from api_keys where id = ?", [id])[0]
      : undefined;
    if (row) {
      return {
        kind: "api-key-update",
        keyHash: String(row.key_hash),
        fields: {
          last_used_at: params[Number(keyUsage[1]) - 1],
          request_count: Number(row.request_count) + 1,
        },
      };
    }
  }
  const keyRevoke = /^update api_keys set revoked_at = \$(\d+) where id = \$(\d+) and revoked_at is null$/i.exec(
    sql,
  );
  if (keyRevoke) {
    const id = Number(params[Number(keyRevoke[2]) - 1]);
    const row = Number.isInteger(id)
      ? store.select("select key_hash from api_keys where id = ?", [id])[0]
      : undefined;
    if (row) {
      return {
        kind: "api-key-update",
        keyHash: String(row.key_hash),
        fields: { revoked_at: params[Number(keyRevoke[1]) - 1] },
      };
    }
  }

  // everything else is already keyed by a stable business key
  return { kind: "sql", sql: query, params };
}
