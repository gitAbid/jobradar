-- Postgres-native column types: text timestamps -> timestamptz, 0/1 ints ->
-- boolean, JSON-in-text -> jsonb. Runs inside the runner's transaction (one
-- ALTER TABLE per table, so each table is rewritten once). Unparseable legacy
-- values become null / '[]' instead of aborting the migration.

-- Naive timestamps in legacy text are read as UTC.
set local timezone = 'UTC';

create function _mig_ts(v text) returns timestamptz language plpgsql as $$
begin
  if v is null or btrim(v) = '' then return null; end if;
  return v::timestamptz;
exception when others then
  return null;
end $$;

create function _mig_jsonb_arr(v text) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  j := v::jsonb;
  if jsonb_typeof(j) = 'array' then return j; end if;
  return '[]'::jsonb;
exception when others then
  return '[]'::jsonb;
end $$;

-- The feed index uses posted_at/fetched_at; rebuilt on the new types below.
drop index if exists idx_listings_feed;

-- boards
alter table boards alter column enabled drop default;
alter table boards alter column filter_keywords drop default;
alter table boards
  alter column enabled type boolean using (enabled <> 0),
  alter column filter_keywords type jsonb using _mig_jsonb_arr(filter_keywords),
  alter column last_fetched_at type timestamptz using _mig_ts(last_fetched_at);
alter table boards alter column enabled set default true;
alter table boards alter column filter_keywords set default '[]'::jsonb;

-- listings
alter table listings alter column is_remote drop default;
alter table listings alter column visa_sponsorship drop default;
alter table listings alter column tags drop default;
alter table listings alter column skills drop default;
alter table listings alter column user_tags drop default;
alter table listings
  alter column is_remote type boolean using (is_remote <> 0),
  alter column visa_sponsorship type boolean using (visa_sponsorship <> 0),
  alter column tags type jsonb using _mig_jsonb_arr(tags),
  alter column skills type jsonb using _mig_jsonb_arr(skills),
  alter column user_tags type jsonb using _mig_jsonb_arr(user_tags),
  alter column posted_at type timestamptz using _mig_ts(posted_at),
  alter column deadline type timestamptz using _mig_ts(deadline),
  alter column fetched_at type timestamptz using coalesce(_mig_ts(fetched_at), now());
alter table listings alter column is_remote set default false;
alter table listings alter column visa_sponsorship set default false;
alter table listings alter column tags set default '[]'::jsonb;
alter table listings alter column skills set default '[]'::jsonb;
alter table listings alter column user_tags set default '[]'::jsonb;

create index idx_listings_feed
  on listings ((coalesce(posted_at, fetched_at)) desc, id desc);

-- small tables
alter table followed_companies
  alter column created_at type timestamptz using coalesce(_mig_ts(created_at), now());
alter table pinned_countries
  alter column created_at type timestamptz using coalesce(_mig_ts(created_at), now());
alter table api_keys
  alter column created_at type timestamptz using coalesce(_mig_ts(created_at), now()),
  alter column last_used_at type timestamptz using _mig_ts(last_used_at),
  alter column revoked_at type timestamptz using _mig_ts(revoked_at);

drop function _mig_ts(text);
drop function _mig_jsonb_arr(text);
