-- Fixed-window (1 hour) counter of failed API-key checks per client (sha256
-- of the client IP, never the raw address). Lets /api/v1 throttle callers
-- presenting invalid keys, which the per-key api_rate cannot see. Old
-- windows are pruned opportunistically by the app.
create table api_auth_fail (
  client text not null,
  window_start timestamptz not null,
  count integer not null,
  primary key (client, window_start)
);
alter table api_auth_fail enable row level security;
