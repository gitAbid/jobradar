import Link from "next/link";
import { Radar } from "lucide-react";
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
    "inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-border-strong bg-surface-raised px-4 text-sm font-semibold text-foreground shadow-xs transition-all duration-150 hover:-translate-y-px hover:bg-subtle hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] items-center justify-center overflow-x-clip py-6 sm:py-10">
      <div className="animate-fade-up relative w-full max-w-sm">
        <div aria-hidden="true" className="absolute -inset-y-8 inset-x-0 -z-10 rounded-[2.5rem] bg-primary/10 blur-3xl sm:-inset-8" />
        <div className="rounded-2xl border border-border bg-surface-raised p-6 shadow-lg sm:p-8">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink shadow-sm">
              <Radar className="h-6 w-6 text-teal-300" aria-hidden="true" />
            </span>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">Welcome to JobRadar</h1>
            <p className="mt-1.5 text-sm text-muted">Sign in to see the openings that fit you.</p>
          </div>
          {error && (
            <p role="alert" className="mt-5 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-6 space-y-3">
            {google && (
              <form action={oauth}>
                <input type="hidden" name="provider" value="google" />
                <button type="submit" className={btn}>
                  <GoogleIcon /> Continue with Google
                </button>
              </form>
            )}
            {github && (
              <form action={oauth}>
                <input type="hidden" name="provider" value="github" />
                <button type="submit" className={btn}>
                  <GitHubIcon /> Continue with GitHub
                </button>
              </form>
            )}
            {!google && !github && !test && (
              <p className="text-center text-sm text-muted">No sign-in providers are configured.</p>
            )}
          </div>
          {test && (
            <form action={testLogin} className="mt-6 space-y-3">
              <div className="flex items-center gap-3 text-2xs font-semibold uppercase tracking-wider text-faint">
                <span className="h-px flex-1 bg-border" />
                <label htmlFor="test-email">Test login · dev only</label>
                <span className="h-px flex-1 bg-border" />
              </div>
              <input
                id="test-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="user@example.com"
                className="field-input min-h-12 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-sm text-foreground placeholder:text-faint focus:outline-none"
              />
              <button type="submit" className={btn}>Sign in as test user</button>
            </form>
          )}
          <p className="mt-6 text-center text-xs leading-relaxed text-faint">
            By continuing you agree to our{" "}
            <Link href="/terms" className="font-medium text-muted underline-offset-2 hover:text-foreground hover:underline">Terms</Link> and{" "}
            <Link href="/privacy" className="font-medium text-muted underline-offset-2 hover:text-foreground hover:underline">Privacy Policy</Link>.
          </p>
        </div>
        <p className="mt-6 text-center text-sm">
          <Link href="/" className="font-medium text-muted transition-colors hover:text-foreground">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.27a12 12 0 0 0 0 10.76l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.27 6.62l4 3.1C6.22 6.88 8.87 4.77 12 4.77Z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57v-2c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22v3.29c0 .32.21.69.82.57A12 12 0 0 0 12 .3Z" />
    </svg>
  );
}
