-- Fixture boards + listings for the Playwright smoke test (no network refresh).
-- Idempotent: safe to load twice. Load after `pnpm db:migrate`.
insert into boards (name, type, url, enabled)
values ('E2E Board A', 'rss', 'https://example.test/a.xml', false),
       ('E2E Board B', 'rss', 'https://example.test/b.xml', false)
on conflict (name) do nothing;

insert into listings
  (board_id, external_id, title, company, location, is_remote, visa_sponsorship,
   remote_scope, tags, skills, url, posted_at, fetched_at, search_text, description, country)
select b.id, v.external_id, v.title, v.company, v.location, v.is_remote, v.visa,
       v.remote_scope, '[]'::jsonb, v.skills::jsonb, 'https://example.test/jobs/' || v.external_id,
       now() - v.age, now(),
       lower(v.title || ' ' || v.company || ' ' || v.location || ' ' || v.skills),
       v.title || ' at ' || v.company, v.country
from (values
  ('E2E Board A', 'e2e-1', 'Senior Kotlin Engineer', 'Acme Robotics', 'Berlin, Germany', false, true, null, '["Kotlin","AWS"]', 'Germany', interval '1 hour'),
  ('E2E Board A', 'e2e-2', 'Java Backend Developer', 'Globex', 'Dhaka, Bangladesh', false, false, null, '["Java","Spring Boot"]', 'Bangladesh', interval '2 hours'),
  ('E2E Board A', 'e2e-3', 'React Frontend Engineer', 'Initech', 'Remote', true, false, 'anywhere', '["React","TypeScript"]', 'Remote', interval '3 hours'),
  ('E2E Board B', 'e2e-4', 'Platform Engineer Kubernetes', 'Umbrella Cloud', 'Toronto, Canada', false, false, null, '["Kubernetes","AWS"]', 'Canada', interval '4 hours'),
  ('E2E Board B', 'e2e-5', 'Data Scientist', 'Hooli', 'London, United Kingdom', false, true, null, '["Python","SQL"]', 'United Kingdom', interval '5 hours'),
  ('E2E Board B', 'e2e-6', 'QA Automation Engineer', 'Stark Industries', 'New York, United States', false, false, null, '["Playwright","Java"]', 'United States', interval '6 hours')
) as v(board, external_id, title, company, location, is_remote, visa, remote_scope, skills, country, age)
join boards b on b.name = v.board
on conflict (board_id, external_id) do nothing;
