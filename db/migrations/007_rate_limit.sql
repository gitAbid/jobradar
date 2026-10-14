-- Fixed-window (1 hour) per-API-key request counter. One atomic upsert per
-- request; old windows are pruned opportunistically by the app.
create table api_rate (
  key_id integer not null references api_keys(id) on delete cascade,
  window_start timestamptz not null,
  count integer not null,
  primary key (key_id, window_start)
);
alter table api_rate enable row level security;
