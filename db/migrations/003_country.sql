-- Precomputed country facet value (see countryFacetValue). The feed query
-- falls back to the SQL CASE for rows where this is still null.
alter table listings add column if not exists country text;
