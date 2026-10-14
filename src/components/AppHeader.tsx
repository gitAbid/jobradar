"use client";

import { Briefcase, Bookmark, Radar, Settings, ShieldCheck, Star } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavLinkActive } from "@/lib/navigation";

const NAV_LINKS = [
  { href: "/", label: "Jobs", icon: Briefcase },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/following", label: "Following", icon: Star },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const ADMIN_LINK = { href: "/admin/boards", label: "Admin", icon: ShieldCheck } as const;

function NavItem({
  href,
  label,
  icon: Icon,
}: (typeof NAV_LINKS)[number] | typeof ADMIN_LINK) {
  const pathname = usePathname();
  const active = isNavLinkActive(pathname, href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 lg:min-h-9 lg:px-3.5 ${
        active
          ? "bg-ink text-white shadow-sm"
          : "text-muted hover:bg-surface-raised hover:text-foreground"
      }`}
    >
      <Icon className={`h-4 w-4 ${active ? "text-teal-300" : "text-faint group-hover:text-primary"}`} />
      {label}
    </Link>
  );
}

/**
 * Two rows on mobile: (1) logo + account, (2) one scrolling strip of the nav
 * followed by pinned-location chips, with a fade at the right edge. On desktop
 * the nav joins row 1 and the pinned chips get their own row only when present.
 * The Admin link is a convenience; /admin/* enforces the role server-side.
 */
export function AppHeader({
  isAdmin = false,
  userMenu,
  pinned,
  hasPinned = false,
  signedOut = false,
}: {
  isAdmin?: boolean;
  userMenu?: ReactNode;
  pinned?: ReactNode;
  hasPinned?: boolean;
  /** Logo + user menu only (landing page visitors). */
  signedOut?: boolean;
}) {
  const links = isAdmin ? [...NAV_LINKS, ADMIN_LINK] : NAV_LINKS;
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="flex min-h-[3.5rem] items-center gap-4 lg:min-h-[4.25rem]">
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white shadow-sm transition-transform group-hover:-rotate-6">
            <Radar className="h-5 w-5 text-teal-300" />
          </span>
          <span>
            <span className="block text-[15px] font-bold leading-none tracking-tight text-foreground">
              Job<span className="text-primary">Radar</span>
            </span>
            <span className="mt-1 hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-faint sm:block">
              Your next move
            </span>
          </span>
        </Link>

        {!signedOut && (
        <nav className="ml-auto hidden items-center gap-1 rounded-2xl bg-subtle p-1 lg:flex" aria-label="Primary navigation">
          {links.map((link) => (
            <NavItem key={link.href} {...link} />
          ))}
        </nav>
        )}

        <div className="ml-auto min-w-0 lg:ml-0">{userMenu}</div>
      </div>

      {!signedOut && (
      <div
        className={`nav-scroll -mx-4 flex items-center gap-1 overflow-x-auto border-t border-border px-4 py-1.5 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] sm:-mx-6 sm:px-6 ${hasPinned ? "" : "lg:hidden"}`}
      >
        <nav className="flex shrink-0 items-center gap-1 lg:hidden" aria-label="Primary navigation">
          {links.map((link) => (
            <NavItem key={link.href} {...link} />
          ))}
        </nav>
        {hasPinned && (
          <div className="flex shrink-0 items-center gap-2 pl-2 pr-8 lg:pl-0">
            <span aria-hidden="true" className="h-5 w-px bg-subtle-2 lg:hidden" />
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-faint">
              Pinned locations
            </span>
            {pinned}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
