import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright must not be bundled — it loads its native browser launcher
  serverExternalPackages: ["playwright"],
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
