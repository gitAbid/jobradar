"use client";

import { KeyRound, LayoutDashboard, MapPin, Radar, Send, SlidersHorizontal, Star } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavLinkActive } from "@/lib/navigation";
import { DbStatusBadge } from "@/components/DbStatusBadge";

const NAV_LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/bangladesh", label: "Bangladesh", icon: MapPin },
  { href: "/following", label: "Following", icon: Star },
  { href: "/applied", label: "Applied", icon: Send },
  { href: "/boards", label: "Boards", icon: SlidersHorizontal },
  { href: "/api-keys", label: "API Keys", icon: KeyRound },
] as const;

function NavItem({
  href,
  label,
  icon: Icon,
}: (typeof NAV_LINKS)[number]) {
  const pathname = usePathname();
  const active = isNavLinkActive(pathname, href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 lg:min-h-9 lg:px-3.5 ${
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "text-slate-600 hover:bg-white hover:text-slate-950"
      }`}
    >
      <Icon className={`h-4 w-4 ${active ? "text-teal-300" : "text-slate-400 group-hover:text-teal-600"}`} />
      {label}
    </Link>
  );
}

export function AppHeader() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="flex min-h-[4.25rem] items-center gap-4">
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm transition-transform group-hover:-rotate-6">
            <Radar className="h-5 w-5 text-teal-300" />
          </span>
          <span>
            <span className="block text-[15px] font-bold leading-none tracking-tight text-slate-950">
              Job<span className="text-teal-600">Radar</span>
            </span>
            <span className="mt-1 hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 sm:block">
              Your next move
            </span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 rounded-2xl bg-slate-100/80 p-1 lg:flex" aria-label="Primary navigation">
          {NAV_LINKS.map((link) => (
            <NavItem key={link.href} {...link} />
          ))}
        </nav>

        <div className="ml-auto flex items-center lg:ml-3">
          <DbStatusBadge />
        </div>
      </div>

      <nav
        className="nav-scroll -mx-4 flex items-center gap-1 overflow-x-auto border-t border-slate-200/80 px-4 py-2 lg:hidden sm:-mx-6 sm:px-6"
        aria-label="Primary navigation"
      >
        {NAV_LINKS.map((link) => (
          <NavItem key={link.href} {...link} />
        ))}
      </nav>
    </div>
  );
}
