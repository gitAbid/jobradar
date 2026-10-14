import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { connection } from "next/server";
import { listPinnedCountries } from "@/db";
import { getTheme, isSoundEnabled } from "@/lib/settings";
import { getSessionUser } from "@/lib/authz";
import { PinnedCountryChip } from "@/components/PinnedCountryChip";
import { ToastProvider } from "@/components/ui";
import { AppHeader } from "@/components/AppHeader";
import { ThemeSync } from "@/components/ThemeSync";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { UserMenu } from "@/components/UserMenu";
import { RefreshStatusBar } from "@/components/RefreshStatusBar";
import Link from "next/link";
import { Radar } from "lucide-react";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const SITE_URL =
  process.env.AUTH_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "JobRadar — your personal job search radar", template: "%s · JobRadar" },
  applicationName: "JobRadar",
  description: "Gather, filter, save, and track the job openings that fit your next move.",
};

/** Header with role-aware nav, user menu and pinned locations; streams in under a static fallback. */
async function Header() {
  await connection(); // request-time read
  const user = await getSessionUser();
  const pinned = user ? await listPinnedCountries(user.id) : [];
  return (
    <>
      <AppHeader
        isAdmin={user?.role === "admin"}
        signedOut={!user}
        userMenu={<UserMenu />}
        hasPinned={pinned.length > 0}
        pinned={pinned.map((country) => (
          <PinnedCountryChip key={country} country={country} />
        ))}
      />
      {user && <ThemeSync theme={await getTheme(user.id)} />}
    </>
  );
}

/** Refresh progress bar; streams in without blocking layout render. */
async function RefreshStatus() {
  await connection(); // request-time read (sound setting)
  const user = await getSessionUser();
  return <RefreshStatusBar soundEnabled={user ? await isSoundEnabled(user.id) : true} />;
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* applies the saved theme before first paint (no flash) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col bg-sand text-foreground antialiased">
        <ToastProvider>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <header className="sticky top-0 z-40 border-b border-border bg-surface-raised/90 backdrop-blur-xl">
          <Suspense fallback={<AppHeader />}>
            <Header />
          </Suspense>
          <Suspense fallback={null}>
            <RefreshStatus />
          </Suspense>
        </header>
        <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {/* pages read the DB at request time (connection()); stream them under the static shell */}
          <Suspense fallback={null}>{children}</Suspense>
        </main>
        <footer className="border-t border-border bg-surface-raised/60">
          <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-8 text-sm text-muted sm:flex-row sm:justify-between sm:px-6">
            <div className="flex flex-col items-center gap-1 sm:items-start">
              <span className="inline-flex items-center gap-2 font-semibold text-foreground">
                <Radar className="h-4 w-4 text-primary" aria-hidden="true" />
                Job<span className="-ml-2 text-primary">Radar</span>
              </span>
              <span className="text-xs text-faint">Your personal job search radar</span>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-6 gap-y-2">
              <Link href="/privacy" className="transition-colors hover:text-foreground">Privacy</Link>
              <Link href="/terms" className="transition-colors hover:text-foreground">Terms</Link>
              <Link href="/bot" className="transition-colors hover:text-foreground">Our crawler</Link>
            </nav>
          </div>
        </footer>
        </ToastProvider>
      </body>
    </html>
  );
}
