import type { Metadata } from "next";
import { Radar } from "lucide-react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "JobRadar — Java job board watcher",
  description: "Watch job boards for Java roles matching your skills",
};

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
              <Link href="/" className="hover:text-slate-900">
                Dashboard
              </Link>
              <Link href="/boards" className="hover:text-slate-900">
                Boards
              </Link>
              <Link href="/applied" className="hover:text-slate-900">
                Applied
              </Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
