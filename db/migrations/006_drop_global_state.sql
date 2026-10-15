-- Listing state is per user (user_listing_state). Preserve the legacy global
-- status/tags for the not-yet-signed-in admin (claimLegacyState reads this
-- table), then drop the global columns.

create table legacy_listing_state as
  select id as listing_id, status, user_tags
    from listings
   where status <> 'new' or user_tags <> '[]'::jsonb;
alter table legacy_listing_state add primary key (listing_id);
alter table legacy_listing_state enable row level security;

-- No other index references the dropped columns (idx_listings_feed is on
-- coalesce(posted_at, fetched_at)).
drop index if exists idx_listings_status;
alter table listings drop column status, drop column user_tags;
