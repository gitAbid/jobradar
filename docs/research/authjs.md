# How to set up Auth.js v5 (next-auth@5 beta) on Next 16.3.8 App Router with GitHub + Google OAuth

**Decision / answer:** Use `next-auth@5.0.0-beta.32` (pinned, not `latest`, which is 4.x) with the **JWT session strategy and no adapter** (option c). The `signIn` callback enforces verified email and upserts `users`/`accounts` via the existing postgres.js `getDb()`. `jwt` callback loads `id` and `role` at sign-in and re-reads `role`/`disabled_at` at most every 5 minutes. No `pg` or Neon adapter package. Before committing, weigh the maintenance-status risk in Gotchas: Auth.js is overseen by the Better Auth team and they recommend Better Auth for new projects.

## Details

**Versions (checked 2026-10-14 via `npm view`)**
- `next-auth@5.0.0-beta.32`, published 2026-07-20. Peer `next ^14 || ^15 || ^16`, depends on `@auth/core@0.41.3`. The `beta` dist-tag points here. `latest` is `4.24.15`, so install explicitly: `pnpm add next-auth@5.0.0-beta.32`.
- `@auth/pg-adapter@1.11.3` and `@auth/neon-adapter@1.11.3` exist, but are not used (see rejected options).

**Adapter strategy comparison**
- (a) `@auth/pg-adapter` with a second `pg` Pool: rejected. Adds a second driver and pool beside postgres.js, against the pgbouncer pool limits. Its table schema is not verified here.
- (b) `@auth/neon-adapter`: rejected. Brings a second Neon driver and is Neon-specific.
- (c) JWT plus our own upsert: chosen. Zero DB reads on ordinary requests. Linking by verified email is explicit in our code. Credentials (test login) works with JWT.
- Database sessions were rejected. They cost one DB read per request on Neon.
- Account linking: one `users` row per lowercased email. Both providers map to it via `accounts(provider, provider_account_id)`. Do NOT set `allowDangerousEmailAccountLinking`, since no adapter is used. Link only when the provider asserts the email is verified.
- Role lookup: `users.role` is copied into the JWT, then exposed on `session.user.role`.
- Revocation/deletion: JWT is valid until `maxAge` unless the throttled `jwt` callback sees `disabled_at` or a missing row. Worst-case lag is 5 minutes. Immediate revocation would need a per-request DB read.

**Files**

`db/migrations/005_auth.sql`
```sql
create table users (
  id uuid primary key default gen_random_uuid(),   -- built in on PG 13+; verify Neon version
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
```
`accounts` is optional, but it records linked providers and gives a stable key if the email changes. Run via `pnpm db:migrate`.

`src/auth.config.ts` (edge-safe, no DB imports; also used by the proxy)
```ts
import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

export const authConfig = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  providers: [GitHub, Google], // reads AUTH_GITHUB_ID/SECRET, AUTH_GOOGLE_ID/SECRET automatically
} satisfies NextAuthConfig;
```

`src/auth.ts` (Node only; full callbacks)
```ts
import "server-only";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { getDb } from "@/db/remote";

// Test login only when explicitly enabled and never in production.
const testLogin =
  process.env.NODE_ENV !== "production" && process.env.ENABLE_TEST_LOGIN === "1";

type UserRow = { id: string; role: "admin" | "user"; disabled_at: Date | null };
const REFRESH_MS = 5 * 60_000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    ...(testLogin
      ? [
          Credentials({
            id: "test",
            name: "Test",
            credentials: { email: { label: "Email", type: "email" } },
            authorize: async (c) =>
              typeof c.email === "string" ? { id: c.email, email: c.email } : null,
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || !user.email) return false;
      const verified =
        account.provider === "google" ? profile?.email_verified === true
        : account.provider === "github" ? !!profile?.email // see Gotchas
        : account.provider === "test";
      if (!verified) return false;

      const sql = getDb();
      const email = user.email.toLowerCase();
      const [row] = await sql<UserRow[]>`
        insert into users (email, name, image) values (${email}, ${user.name ?? null}, ${user.image ?? null})
        on conflict (email) do update set
          name = coalesce(excluded.name, users.name),
          image = coalesce(excluded.image, users.image),
          updated_at = now()
        returning id, role, disabled_at`;
      if (row.disabled_at) return false;
      await sql`
        insert into accounts (provider, provider_account_id, user_id)
        values (${account.provider}, ${account.providerAccountId}, ${row.id})
        on conflict (provider, provider_account_id) do nothing`;
      return true;
    },

    async jwt({ token, user, account, trigger }) {
      // Sign-in: copy the DB identity into the token.
      if (account && user?.email) {
        const [row] = await getDb()<UserRow[]>`
          select id, role, disabled_at from users where email = ${user.email.toLowerCase()}`;
        if (!row || row.disabled_at) return null;
        token.uid = row.id;
        token.role = row.role;
        token.checkedAt = Date.now();
        return token;
      }
      // Throttled refresh: role changes and revocation within REFRESH_MS.
      const stale = Date.now() - ((token.checkedAt as number) ?? 0) > REFRESH_MS;
      if (token.uid && (trigger === "update" || stale)) {
        const [row] = await getDb()<UserRow[]>`
          select id, role, disabled_at from users where id = ${token.uid as string}`;
        if (!row || row.disabled_at) return null;
        token.role = row.role;
        token.checkedAt = Date.now();
      }
      return token;
    },

    session({ session, token }) {
      session.user.id = token.uid as string;
      session.user.role = token.role as "admin" | "user";
      return session;
    },
  },
});
```
Type augmentation is needed for `session.user.id/role` and `token.uid/role` (see Gotchas).

`src/app/api/auth/[...nextauth]/route.ts`
```ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

`src/proxy.ts` (optimistic cookie check only; no DB)
```ts
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export const proxy = auth((req) => {
  if (!req.auth && !req.nextUrl.pathname.startsWith("/login")) {
    return Response.redirect(new URL("/login", req.nextUrl.origin));
  }
});

// Static literal only. Limit to private routes; these names are placeholders.
export const config = {
  matcher: ["/following/:path*", "/api-keys/:path*", "/admin/:path*"],
};
```
`src/proxy.ts` is placed inside `src/` because the project has `src/app`.

`src/lib/auth-dal.ts` (authoritative check, used by pages, actions and route handlers)
```ts
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

// React cache dedupes within one render pass. Not a cross-request cache.
export const getSessionUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { id: session.user.id, role: session.user.role };
});

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("forbidden");
  return user;
}
```

Usage:
- Server action: `"use server"; export async function save(fd: FormData) { const u = await requireUser(); ... }`
- Route handler: `const u = await getSessionUser(); if (!u) return new Response(null, { status: 401 });`
- Server component (cacheComponents): read inside a `<Suspense>` boundary, not at the top of a layout. Per `authentication-with-cache-components.md`, a request read cannot be prerendered, so it streams.
- Cached data: resolve the user outside the cache, then pass `userId` into a `"use cache"` function with `cacheTag(\`following:${userId}\`)`. `auth()` and `cookies()` must not run inside `"use cache"`. `"use cache: private"` is the only cache scope that may read cookies.

Sign in and out from a server action or client: `await signIn("github", { redirectTo: "/" })` and `await signOut({ redirectTo: "/" })`. Both are exported from `src/auth.ts`.

**Env vars (`.env.local` and the host)**
```
AUTH_SECRET=                 # openssl rand -base64 32, or `pnpm exec auth secret`
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_TRUST_HOST=true         # set on Vercel or behind any reverse proxy
AUTH_URL=                    # optional; auto-detected in most environments
ENABLE_TEST_LOGIN=1          # dev/e2e only; ignored when NODE_ENV=production
```

**OAuth callback URLs**
- GitHub: `http://localhost:3000/api/auth/callback/github` and `https://<domain>/api/auth/callback/github`
- Google: `http://localhost:3000/api/auth/callback/google` and `https://<domain>/api/auth/callback/google` (Authorized redirect URIs)

**Test login** is the `Credentials` provider with id `test`, registered only when `testLogin` is true. Trigger it with `signIn("test", { email, redirectTo })` from a dev/e2e-only server action.

## Gotchas
- **Maintenance status.** Auth.js is "now maintained and overseen by the Better Auth team" (announced 2025-09-22). Its post says security patches continue, and it "strongly recommend[s] new projects to start with Better Auth", with stateless no-DB sessions as the stated gap. beta.32 is the July 2026 security release. Escalate this to the user before committing.
- The `latest` tag is 4.x. Always pin `next-auth@5.0.0-beta.32`.
- Proxy runs on the Node runtime by default in Next 16. The `runtime` config is not allowed in proxy files. Keep the proxy free of DB calls: it uses `authConfig` only, so the DB jwt logic is not triggered there.
- Proxy is not authorization. Enforce in `requireUser` and the DAL. Next docs say proxy "should not be used as a full session management or authorization solution."
- `auth()` reads cookies and headers, so it cannot run in `"use cache"`. Calling `cookies()` outside `<Suspense>` blocks prerendering.
- Type augmentation is required (`src/types/next-auth.d.ts`): extend `Session["user"]` with `id` and `role`, and `JWT` with `uid`, `role`, `checkedAt`. Auth.js by default exposes only `email`, `name` and `image` to the client.
- `jwt` returning `null` is in the `Awaitable<null | JWT>` type. The resulting sign-out behaviour is unverified and must be tested.
- `disabled_at` and role changes take up to 5 minutes to appear (`REFRESH_MS`). Lower it if needed; each refresh is one indexed PK read.
- GitHub email can be null when the user's email is private. The Auth.js GitHub provider's handling is unverified here. Check `node_modules/next-auth/providers/github.js` after install, or fetch the verified primary email from the GitHub API. Until then, the GitHub branch in `signIn` is unsafe for linking.
- Google linking relies on `profile.email_verified === true` (Google OIDC claim).
- postgres.js is already configured with `prepare: false` for pgbouncer. The queries above are simple, so they work through the pooler.
- Credentials/JWT: the Credentials provider requires the JWT strategy. This is consistent with option (c). Stated from Auth.js knowledge, not re-verified.
- GitHub OAuth Apps accept one callback URL, so use separate apps for dev and prod. Google may need the consent screen to list test users while in "Testing" mode. Both are from my knowledge, not fetched here.

## Sources
- `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` (Next 16.3.8 bundled docs) — proxy convention and the `src` placement
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` (bundled, 16.3.8) — Node runtime default, `runtime` config not allowed, static matcher, runs on every request without a matcher
- `node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md` (bundled, 16.3.8) — session reads stream behind Suspense, `use cache: private` reads cookies, plain `use cache` does not, extract `userId` pattern
- `node_modules/next/dist/docs/01-app/02-guides/authentication.md` (bundled, 16.3.8) — proxy for optimistic checks only, DAL with React `cache`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md` (bundled, 16.3.8) — `cookies()` outside Suspense prevents prerender
- Context7 `/websites/authjs_dev` (Auth.js docs snapshot, date not reported) — setup, edge-compatibility split, testing Credentials, RBAC/JWT callbacks, signIn callback, `jwt` return type, env var inference and callback URL
- `https://authjs.dev/guides/upgrade-to-v5` (via Context7) — `AUTH_` prefix, `AUTH_TRUST_HOST`, `AUTH_SECRET` as the only required variable
- `npm view next-auth@5.0.0-beta.32`, `npm view next-auth dist-tags`, `npm view @auth/pg-adapter|@auth/neon-adapter version` (run 2026-10-14) — versions, peers, dist-tags
- `https://www.better-auth.com/blog/authjs-joins-better-auth` (fetched 2026-10-14; post dated 2025-09-22) — maintenance status and recommendation
- `https://better-auth.com/blog/security-update-july-2026` (search snippet only, not fetched) — July 2026 advisories fixed in beta.32, v4.24.15, @auth/core 0.41.3
