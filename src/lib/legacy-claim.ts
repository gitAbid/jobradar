import { q } from "@/db";

/**
 * Copy today's global (single-user) state to `userId`: non-default listing
 * status/tags (from legacy_listing_state), followed companies, pinned
 * countries, API keys and the keyword/sound preferences. Runs once — the
 * `legacy_claimed` marker in app_settings gates it.
 *
 * One statement, so it is atomic: the marker insert is the gate, and every
 * other write is conditional on the marker insert having succeeded (a
 * concurrent or repeated call inserts nothing and changes nothing).
 * Returns true if this call performed the claim.
 */
export async function claimLegacyState(userId: string): Promise<boolean> {
  const marker = JSON.stringify({ userId, claimedAt: new Date().toISOString() });
  const rows = await q<{ claimed: boolean }>(
    `with gate as (
       insert into app_settings (key, value) values ('legacy_claimed', $2::text)
       on conflict (key) do nothing
       returning 1
     ),
     states as (
       insert into user_listing_state (user_id, listing_id, status, user_tags)
       select $1::uuid, l.id, ls.status, ls.user_tags
         from legacy_listing_state ls
         join listings l on l.id = ls.listing_id
        where exists (select 1 from gate)
       on conflict do nothing
       returning 1
     ),
     prefs as (
       insert into user_settings (user_id, key, value)
       select $1::uuid, a.key, a.value
         from app_settings a
        where a.key in ('global_keywords', 'sound_enabled')
          and exists (select 1 from gate)
       on conflict do nothing
       returning 1
     ),
     f as (
       update followed_companies set user_id = $1::uuid
        where user_id is null and exists (select 1 from gate)
       returning 1
     ),
     p as (
       update pinned_countries set user_id = $1::uuid
        where user_id is null and exists (select 1 from gate)
       returning 1
     ),
     k as (
       update api_keys set user_id = $1::uuid
        where user_id is null and exists (select 1 from gate)
       returning 1
     )
     select exists (select 1 from gate) as claimed
       from (select count(*) from states) s,
            (select count(*) from f) f2,
            (select count(*) from p) p2,
            (select count(*) from k) k2,
            (select count(*) from prefs) pr`,
    [userId, marker],
  );
  return rows[0]?.claimed === true;
}
