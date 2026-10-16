import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// No nonces: Next's inline bootstrap scripts need 'unsafe-inline'. React uses
// eval for debugging only in dev. The app loads no external assets.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://lh3.googleusercontent.com https://avatars.githubusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  // 'use cache' for the shared listings pool (see src/lib/job-query.ts)
  cacheComponents: true,
  poweredByHeader: false,
  // Legacy URLs from before the P5.6 IA change (query strings pass through).
  // /bangladesh is a page redirect (src/app/bangladesh) that uses the bd.ts preset.
  async redirects() {
    return [
      { source: "/applied", destination: "/saved", permanent: true },
      { source: "/api-keys", destination: "/settings#api-keys", permanent: true },
      { source: "/boards", destination: "/admin/boards", permanent: true },
      { source: "/admin", destination: "/admin/boards", permanent: false },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // playwright-core must not be bundled — it loads its native browser launcher
  serverExternalPackages: ["playwright-core"],
  // playwright's registry reads browsers.json at import; Vercel's file
  // tracing drops it (not statically referenced), which breaks the dynamic
  // import inside the refresh functions — force-include it for the routes
  // that can render pages.
  outputFileTracingIncludes: {
    "/api/refresh": ["./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/browsers.json"],
    "/api/refresh/cron": ["./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/browsers.json"],
  },
};

export default nextConfig;
