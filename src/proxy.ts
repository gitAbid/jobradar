import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const PUBLIC_PREFIXES = ["/signin", "/privacy", "/terms", "/api/auth", "/api/v1", "/bot", "/_next"];
const PUBLIC_EXACT = new Set([
  "/api/refresh/cron",
  "/api/health",
  "/robots.txt",
  "/favicon.ico",
  "/",
  "/manifest.webmanifest",
  "/apple-icon",
  "/opengraph-image",
  "/sitemap.xml",
]);
const STATIC_FILE = /\.(?:ico|png|jpe?g|gif|svg|webp|avif|txt|xml|css|js|map|woff2?|ttf|otf|webmanifest)$/i;

/** Paths the proxy lets through without a session (optimistic check only). */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  // Other API routes enforce auth themselves (401), they are never redirected.
  if (pathname === "/api" || pathname.startsWith("/api/")) return true;
  return STATIC_FILE.test(pathname);
}

const { auth } = NextAuth(authConfig);

export const proxy = auth((req) => {
  const { pathname, search } = req.nextUrl;
  if (req.auth || isPublicPath(pathname)) return NextResponse.next();
  const url = new URL("/signin", req.nextUrl.origin);
  url.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(url);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
