import { q, qOne } from "@/db";

/** Everything stored about one user, as a JSON-serializable object. Never includes key hashes. */
export async function buildAccountExport(userId: string) {
  const profile = await qOne<{ email: string; name: string | null; created_at: unknown }>(
    "select email, name, created_at from users where id = $1",
    [userId],
  );
  const [settings, states, followed, pinned, keys] = await Promise.all([
    q<{ key: string; value: string }>("select key, value from user_settings where user_id = $1 order by key", [userId]),
    q(
      `select s.status, s.user_tags as tags, s.updated_at, l.title, l.company, l.url
         from user_listing_state s join listings l on l.id = s.listing_id
        where s.user_id = $1 order by s.updated_at desc, s.listing_id`,
      [userId],
    ),
    q<{ name: string }>("select name from followed_companies where user_id = $1 order by lower(name)", [userId]),
    q<{ name: string }>("select name from pinned_countries where user_id = $1 order by lower(name)", [userId]),
    q(
      "select name, prefix, created_at, last_used_at, revoked_at from api_keys where user_id = $1 order by id",
      [userId],
    ),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    profile: profile ? { email: profile.email, name: profile.name, createdAt: profile.created_at } : null,
    settings: Object.fromEntries(settings.map((r) => [r.key, r.value])),
    listingStates: states,
    followedCompanies: followed.map((r) => r.name),
    pinnedCountries: pinned.map((r) => r.name),
    apiKeys: keys,
  };
}
