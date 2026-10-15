# Final branch review (P6.4) — 2026-10-15

Scope: `git diff main...HEAD` on `prod-readiness` (51 commits, P0.1–P6.3).

## Security review
No HIGH/MEDIUM findings at ≥80% confidence. Checked: test-login gating (dev + flag only),
verified-email account linking, ADMIN_EMAIL promotion, JWT re-check, callbackUrl sanitising,
per-user SQL scoping of every action and API route, admin gates, parameterised SQL in the feed
builder, SSRF guard (DNS pinning, redirect re-validation, IPv4-mapped/NAT64), API key hashing and
revocation, cron secret comparison, the single `dangerouslySetInnerHTML` (constant theme script),
export contents and error messages.

## Standards review
No hard violations of AGENTS.md / implementer rules. Judgement-call smells:
- try/`requireX`/catch-`AuthError` gate duplicated in ~7 actions/routes with slightly different
  401/403 wording → one shared `gate`/`withAdmin` in `src/lib/authz.ts`.
- Cache tag strings (`"listings"`, `` `user-state:${id}` ``) repeated across files → tag constants.
- `commit()`/`revalidateAll()` in `src/app/actions.ts` are thin, vaguely named wrappers.
- `src/lib/job-query.ts` mixes SQL building, caching and user-state tagging.

## Spec review
Open / partial:
- UI audit §2: tokens exist but ~12 `shadow-[…]` and ~48 `text-[Npx]` remain in components;
  `FacetSidebar` still uses magic `top-[8.75rem] h-[calc(100vh-10rem)]`.
- Audit #10: migrations run only once the Vercel build command is set to
  `pnpm db:migrate && pnpm build` (user action, pending prod-migration approval).
- Audit #15 / P4.3: bare `catch {}` blocks and `console.*` logging remain until Sentry lands.
- Audit #6: rate limit is per key only; requests with invalid keys are unthrottled and each does a
  key lookup.
- Onboarding pre-filters the feed by country only (keywords are saved but not put in the URL).

Beyond the cards (accepted): GitHub verified-primary-email check, `users.disabled_at`, expiry also
keeps tagged listings, per-user cache tags, 30s health probe cache, TokyoDev disabled (403).

E2E runs against `next dev` because the test login is disabled in production builds; the
production build is covered by the CI `build` job, not by e2e.
