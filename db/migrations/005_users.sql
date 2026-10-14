-- Multi-user schema: Auth.js identity tables (JWT sessions, no adapter),
-- per-user listing state and settings, and per-user ownership of follows,
-- pins and API keys. listings.status / listings.user_tags are kept; the legacy
-- single-user state is copied to the admin by claimLegacyState().

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,                      -- always stored lowercased
  name text,
  image text,
  role text not null default 'user' check (role in ('admin', 'user')),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table accounts (
  provider text not null,
  provider_account_id text not null,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, provider_account_id)
);
create index accounts_user_id_idx on accounts (user_id);

create table user_listing_state (
  user_id uuid not null references users(id) on delete cascade,
  listing_id integer not null references listings(id) on delete cascade,
  status text not null default 'new' check (status in ('new','favorite','applied','hidden')),
  user_tags jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index idx_user_listing_state_status on user_listing_state (user_id, status);

create table user_settings (
  user_id uuid not null references users(id) on delete cascade,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Existing rows stay unowned (null) until claimed.
alter table followed_companies add column user_id uuid references users(id) on delete cascade;
alter table pinned_countries add column user_id uuid references users(id) on delete cascade;
alter table api_keys add column user_id uuid references users(id) on delete cascade;

drop index uq_followed_companies_name;
drop index uq_pinned_countries_name;
create unique index uq_followed_companies_user_name on followed_companies (user_id, lower(name));
create unique index uq_pinned_countries_user_name on pinned_countries (user_id, lower(name));
create index idx_api_keys_user on api_keys (user_id);

alter table users enable row level security;
alter table accounts enable row level security;
alter table user_listing_state enable row level security;
alter table user_settings enable row level security;
