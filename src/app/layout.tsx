import type { Metadata } from "next";
import { Radar, MapPin, X } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getDb, listPinnedCountries } from "@/db";
import { togglePinCountryAction } from "@/app/actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "JobRadar — Java job board watcher",
  description: "Watch job boards for Java roles matching your skills",
};

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/boards", label: "Boards" },
  { href: "/following", label: "Following" },
  { href: "/applied", label: "Applied" },
];

/** Pinned countries shown in the nav; streams in without blocking layout render. */
async function PinnedCountriesNav() {
  await connection(); // request-time read
  const pinned = listPinnedCountries(getDb());
  if (pinned.length === 0) return null;

  return (
    <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
      {pinned.map((country) => (
        <span
          key={country}
          className="group inline-flex items-center overflow-hidden rounded-full border border-slate-200 bg-slate-50 text-sm text-slate-600"
        >
          <Link
            href={`/?country=${encodeURIComponent(country)}`}
            title={`Show ${country} jobs`}
            className="inline-flex items-center gap-1 py-1 pl-2 pr-1 hover:text-emerald-700"
          >
            <MapPin className="h-3.5 w-3.5 text-emerald-600" />
            {country}
          </Link>
          <form action={togglePinCountryAction}>
            <input type="hidden" name="country" value={country} />
            <button
              type="submit"
              title={`Unpin ${country}`}
              className="p-1 pr-1.5 text-slate-300 transition group-hover:text-slate-400 hover:!text-red-500"
            >
              <X className="h-3 w-3" />
            </button>
          </form>
        </span>
      ))}
    </div>
  );
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
              <Radar className="h-5 w-5 text-emerald-600" />
              Job<span className="-ml-1 text-emerald-600">Radar</span>
            </Link>
            <div className="flex items-center gap-4 text-sm text-slate-600">
              {NAV_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="hover:text-slate-900">
                  {l.label}
                </Link>
              ))}
            </div>
            <Suspense fallback={null}>
              <PinnedCountriesNav />
            </Suspense>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
