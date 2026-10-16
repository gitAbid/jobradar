import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

// /.well-known: crawler/agent probes (security.txt, ai-catalog.json, …) must get a
// real 404, not a 307 to the sign-in page's HTML.
const PUBLIC_PREFIXES = ["/signin", "/privacy", "/terms", "/api/auth", "/api/v1", "/bot", "/_next", "/.well-known"];
const PUBLIC_EXACT = new Set([
  "/api/refresh/cron",
  "/api/health",
  "/robots.txt",
  "/favicon.ico",
  "/",
  "/welcome",
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

/**
 * Anonymous "/" is served by the static landing route (same URL). Optimistic,
 * like the redirect below: a session that later fails server-side checks still
 * reaches the dashboard route, which falls back to the same landing.
 */
export function landingRewritePath(pathname: string, signedIn: boolean): string | null {
  return !signedIn && pathname === "/" ? "/welcome" : null;
}

const { auth } = NextAuth(authConfig);

export const proxy = auth((req) => {
  const { pathname, search } = req.nextUrl;
  const landing = landingRewritePath(pathname, !!req.auth);
  if (landing) {
    const url = req.nextUrl.clone();
    url.pathname = landing;
    return NextResponse.rewrite(url);
  }
  if (req.auth || isPublicPath(pathname)) return NextResponse.next();
  const url = new URL("/signin", req.nextUrl.origin);
  url.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(url);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
