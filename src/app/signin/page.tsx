import { signIn } from "@/auth";
import { sanitizeCallbackUrl } from "@/lib/callback-url";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  AccessDenied: "Sign-in was denied. Your email must be verified with the provider and your account enabled.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const callbackUrl = sanitizeCallbackUrl(sp.callbackUrl);
  const google = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
  const github = !!(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
  const test = process.env.NODE_ENV !== "production" && process.env.ENABLE_TEST_LOGIN === "1";
  const error = sp.error ? (ERRORS[sp.error] ?? "Could not sign you in. Please try again.") : null;

  async function oauth(formData: FormData) {
    "use server";
    const provider = formData.get("provider");
    if (provider !== "google" && provider !== "github") return;
    await signIn(provider, { redirectTo: callbackUrl });
  }

  async function testLogin(formData: FormData) {
    "use server";
    if (!(process.env.NODE_ENV !== "production" && process.env.ENABLE_TEST_LOGIN === "1")) return;
    await signIn("test", { email: String(formData.get("email") ?? ""), redirectTo: callbackUrl });
  }

  const btn =
    "inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-surface-raised px-4 text-sm font-medium text-foreground transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  return (
    <div className="mx-auto max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-foreground">Sign in to JobRadar</h1>
      <p className="mt-1 text-sm text-muted">Use a verified account to continue.</p>
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-5 space-y-3">
        {google && (
          <form action={oauth}>
            <input type="hidden" name="provider" value="google" />
            <button type="submit" className={btn}>Continue with Google</button>
          </form>
        )}
        {github && (
          <form action={oauth}>
            <input type="hidden" name="provider" value="github" />
            <button type="submit" className={btn}>Continue with GitHub</button>
          </form>
        )}
        {!google && !github && !test && (
          <p className="text-sm text-muted">No sign-in providers are configured.</p>
        )}
      </div>
      {test && (
        <form action={testLogin} className="mt-6 space-y-3 border-t border-border pt-5">
          <label className="block text-xs font-medium uppercase tracking-wide text-muted" htmlFor="test-email">
            Test login (dev only)
          </label>
          <input
            id="test-email"
            name="email"
            type="email"
            required
            placeholder="user@example.com"
            className="min-h-11 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm text-foreground"
          />
          <button type="submit" className={btn}>Sign in as test user</button>
        </form>
      )}
    </div>
  );
}
