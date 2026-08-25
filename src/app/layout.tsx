import type { Metadata } from "next";
import { MapPin, X } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getDb, listPinnedCountries } from "@/db";
import { togglePinCountryAction } from "@/app/actions";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "JobRadar — your personal job search radar",
  description: "Gather, filter, save, and track the job openings that fit your next move.",
};

/** Pinned countries shown in the nav; streams in without blocking layout render. */
async function PinnedCountriesNav() {
  await connection(); // request-time read
  const pinned = listPinnedCountries(getDb());
  if (pinned.length === 0) return null;

  return (
    <div className="border-t border-slate-200/80 bg-white/70">
      <div className="mx-auto flex min-h-10 max-w-7xl items-center gap-3 overflow-x-auto px-4 py-1.5 sm:px-6">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
          Pinned locations
        </span>
        {pinned.map((country) => (
          <span
            key={country}
            className="group inline-flex shrink-0 items-center overflow-hidden rounded-full border border-teal-200 bg-teal-50 text-xs font-medium text-teal-800"
          >
            <Link
              href={`/?country=${encodeURIComponent(country)}`}
              title={`Show ${country} jobs`}
              className="inline-flex min-h-8 items-center gap-1 py-1 pl-2.5 pr-1 hover:text-teal-950"
            >
              <MapPin className="h-3.5 w-3.5 text-teal-600" />
              {country}
            </Link>
            <form action={togglePinCountryAction}>
              <input type="hidden" name="country" value={country} />
              <button
                type="submit"
                title={`Unpin ${country}`}
                aria-label={`Unpin ${country}`}
                className="inline-flex min-h-8 items-center p-1.5 text-teal-400 transition-colors hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </form>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-sand text-slate-950 antialiased">
        <a className="skip-link" href="#main-content">Skip to content</a>
        <header className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/90 backdrop-blur-xl">
          <AppHeader />
          <Suspense fallback={null}>
            <PinnedCountriesNav />
          </Suspense>
        </header>
        <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </body>
    </html>
  );
}
