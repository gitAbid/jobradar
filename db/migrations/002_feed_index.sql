-- Feed ordering: every list view sorts by coalesce(posted_at, fetched_at)
-- desc, id desc (id breaks ties deterministically for paging and dedupe).
create index if not exists idx_listings_feed
  on listings ((coalesce(posted_at, fetched_at)) desc, id desc);
