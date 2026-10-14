import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { getDb } from "@/db/remote";
import { claimLegacyState } from "@/lib/legacy-claim";

// Test login only when explicitly enabled and never in production.
const testLogin =
  process.env.NODE_ENV !== "production" && process.env.ENABLE_TEST_LOGIN === "1";

type UserRow = { id: string; role: "admin" | "user"; disabled_at: Date | null };
const REFRESH_MS = 5 * 60_000;

function isAdminEmail(email: string): boolean {
  const admin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return !!admin && admin === email;
}

/** GitHub: the profile email may be private/unverified; require a verified primary one. */
async function githubVerifiedEmail(accessToken: string | undefined, claimed: string | null | undefined) {
  if (!accessToken || !claimed) return false;
  try {
    const res = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "jobradar",
      },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const list = (await res.json()) as { email?: string; verified?: boolean; primary?: boolean }[];
    return (
      Array.isArray(list) &&
      list.some(
        (e) =>
          e.verified === true &&
          e.primary === true &&
          e.email?.toLowerCase() === claimed.toLowerCase(),
      )
    );
  } catch {
    return false;
  }
}

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
              typeof c.email === "string" && c.email.includes("@")
                ? { id: c.email.toLowerCase(), email: c.email.toLowerCase() }
                : null,
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || !user.email) return false;
      let verified = false;
      if (account.provider === "google") verified = profile?.email_verified === true;
      else if (account.provider === "github")
        verified = await githubVerifiedEmail(account.access_token, user.email);
      else if (account.provider === "test") verified = testLogin;
      if (!verified) return false;

      const sql = getDb();
      const email = user.email.toLowerCase();
      const admin = isAdminEmail(email);
      const [row] = await sql<UserRow[]>`
        insert into users (email, name, image, role)
        values (${email}, ${user.name ?? null}, ${user.image ?? null}, ${admin ? "admin" : "user"})
        on conflict (email) do update set
          name = coalesce(excluded.name, users.name),
          image = coalesce(excluded.image, users.image),
          role = case when ${admin}::boolean then 'admin' else users.role end,
          updated_at = now()
        returning id, role, disabled_at`;
      if (!row || row.disabled_at) return false;
      await sql`
        insert into accounts (provider, provider_account_id, user_id)
        values (${account.provider}, ${account.providerAccountId}, ${row.id})
        on conflict (provider, provider_account_id) do nothing`;

      if (admin) {
        try {
          await claimLegacyState(row.id);
        } catch (e) {
          console.error("claimLegacyState failed:", e instanceof Error ? e.message : "unknown error");
        }
      }
      return true;
    },

    async jwt({ token, account, trigger }) {
      // Sign-in: copy the DB identity into the token (resolved via the linked account).
      if (account) {
        const [row] = await getDb()<UserRow[]>`
          select u.id, u.role, u.disabled_at
            from accounts a join users u on u.id = a.user_id
           where a.provider = ${account.provider}
             and a.provider_account_id = ${account.providerAccountId}`;
        if (!row || row.disabled_at) return null;
        token.uid = row.id;
        token.role = row.role;
        token.checkedAt = Date.now();
        return token;
      }
      // Throttled refresh: role changes and revocation within REFRESH_MS.
      const uid = typeof token.uid === "string" ? token.uid : null;
      const stale = Date.now() - (typeof token.checkedAt === "number" ? token.checkedAt : 0) > REFRESH_MS;
      if (uid && (trigger === "update" || stale)) {
        const [row] = await getDb()<UserRow[]>`
          select id, role, disabled_at from users where id = ${uid}`;
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
