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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* applies the saved theme before first paint (no flash) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-sand text-slate-950 antialiased">
        <ToastProvider>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <header className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/90 backdrop-blur-xl">
          <Suspense fallback={<AppHeader />}>
            <Header />
          </Suspense>
          <Suspense fallback={null}>
            <RefreshStatus />
          </Suspense>
        </header>
        <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          {/* pages read the DB at request time (connection()); stream them under the static shell */}
          <Suspense fallback={null}>{children}</Suspense>
        </main>
        <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted sm:px-6">
          <span>JobRadar</span>
          <nav aria-label="Legal" className="flex gap-4">
            <Link href="/privacy" className="hover:underline">Privacy</Link>
            <Link href="/terms" className="hover:underline">Terms</Link>
          </nav>
        </footer>
        </ToastProvider>
      </body>
    </html>
  );
}
