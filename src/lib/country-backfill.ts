import { countryFacetValue } from "./facets.ts";

// Relative .ts import: scripts/backfill-country.ts runs under Node type stripping.
export type BackfillExec = (
  text: string,
  values: unknown[],
) => Promise<Record<string, unknown>[]>;

/**
 * Fill `listings.country` for rows that don't have it yet, in batches.
 * Returns the number of rows updated.
 */
export async function backfillCountries(exec: BackfillExec, batch = 2000): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await exec(
      "select id, location, is_remote, remote_scope from listings where country is null order by id limit $1::int",
      [batch],
    );
    if (rows.length === 0) return total;
    const ids = rows.map((r) => Number(r.id));
    const countries = rows.map((r) =>
      countryFacetValue({
        location: String(r.location ?? ""),
        isRemote: r.is_remote === true,
        remoteScope: (r.remote_scope as string | null) ?? null,
      }),
    );
    await exec(
      `update listings l set country = v.country
         from unnest($1::int[], $2::text[]) as v(id, country)
        where l.id = v.id`,
      [ids, countries],
    );
    total += rows.length;
  }
}
