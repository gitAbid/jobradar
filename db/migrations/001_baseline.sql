create table if not exists boards (
  id                   integer generated always as identity primary key,
  name                 text not null unique,
  type                 text not null,
  url                  text not null,
  enabled              integer not null default 1,
  filter_keywords      text not null default '[]',
  last_fetched_at      text,
  last_status          text,
  fetch_interval_hours integer not null default 4
);

create table if not exists listings (
  id               integer generated always as identity primary key,
  board_id         integer not null references boards(id) on delete cascade,
  external_id      text not null,
  title            text not null,
  company          text not null default '',
  location         text not null default '',
  is_remote        integer not null default 0,
  visa_sponsorship integer not null default 0,
  remote_scope     text,
  tags             text not null default '[]',
  skills           text not null default '[]',
  url              text not null default '',
  posted_at        text,
  deadline         text,
  fetched_at       text not null,
  status           text not null default 'new'
                   check (status in ('new','favorite','applied','hidden')),
  user_tags        text not null default '[]',
  search_text      text not null default '',
  description      text not null default '',
  unique (board_id, external_id)
);
create index if not exists idx_listings_board on listings(board_id);
create index if not exists idx_listings_status on listings(status);

create table if not exists app_settings (
  key   text primary key,
  value text not null
);

create table if not exists followed_companies (
  id         integer generated always as identity primary key,
  name       text not null,
  created_at text not null
);
create unique index if not exists uq_followed_companies_name
  on followed_companies (lower(name));

create table if not exists pinned_countries (
  id         integer generated always as identity primary key,
  name       text not null,
  created_at text not null
);
create unique index if not exists uq_pinned_countries_name
  on pinned_countries (lower(name));

create table if not exists api_keys (
  id            integer generated always as identity primary key,
  name          text not null,
  key_hash      text not null unique,
  prefix        text not null,
  created_at    text not null,
  last_used_at  text,
  request_count integer not null default 0,
  revoked_at    text
);

-- Tables live in the API-exposed `public` schema; RLS with no policies
-- locks the Data API out while the postgres-role app connection
-- (table owner) keeps full access.
alter table boards enable row level security;
alter table listings enable row level security;
alter table app_settings enable row level security;
alter table followed_companies enable row level security;
alter table pinned_countries enable row level security;
alter table api_keys enable row level security;
