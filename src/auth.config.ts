import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

// Edge-safe: no DB imports. Shared by the proxy and the full config in auth.ts.
const providers: NextAuthConfig["providers"] = [];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  // user:email is needed to verify the primary email via the API
  providers.push(GitHub({ authorization: { params: { scope: "read:user user:email" } } }));
}

export const authConfig = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/signin" },
  providers,
} satisfies NextAuthConfig;
