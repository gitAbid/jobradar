import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { connection } from "next/server";
import { listPinnedCountries } from "@/db";
import { isSoundEnabled } from "@/lib/settings";
import { getSessionUser } from "@/lib/authz";
import { PinnedCountryChip } from "@/components/PinnedCountryChip";
import { ToastProvider } from "@/components/ui";
import { AppHeader } from "@/components/AppHeader";
import { UserMenu } from "@/components/UserMenu";
import { RefreshStatusBar } from "@/components/RefreshStatusBar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "JobRadar — your personal job search radar",
  description: "Gather, filter, save, and track the job openings that fit your next move.",
};

/** Pinned countries shown in the nav; streams in without blocking layout render. */
async function PinnedCountriesNav() {
  await connection(); // request-time read
  const user = await getSessionUser();
  if (!user) return null; // signed out: no pins
  const pinned = await listPinnedCountries(user.id);
  if (pinned.length === 0) return null;

  return (
    <div className="border-t border-slate-200/80 bg-white/70">
      <div className="mx-auto flex min-h-10 max-w-7xl items-center gap-3 overflow-x-auto px-4 py-1.5 sm:px-6">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
          Pinned locations
        </span>
        {pinned.map((country) => (
          <PinnedCountryChip key={country} country={country} />
        ))}
      </div>
    </div>
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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-sand text-slate-950 antialiased">
        <ToastProvider>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <header className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/90 backdrop-blur-xl">
          <AppHeader />
          <div className="mx-auto flex max-w-7xl justify-end px-4 pb-1 sm:px-6">
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </div>
          <Suspense fallback={null}>
            <PinnedCountriesNav />
          </Suspense>
          <Suspense fallback={null}>
            <RefreshStatus />
          </Suspense>
        </header>
        <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          {/* pages read the DB at request time (connection()); stream them under the static shell */}
          <Suspense fallback={null}>{children}</Suspense>
        </main>
        </ToastProvider>
      </body>
    </html>
  );
}
