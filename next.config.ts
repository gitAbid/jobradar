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
  // Build-time inlining: these are resolved from the build environment (a
  // deployment .env file or platform env vars) and baked into the server
  // bundle, so runtime works even without platform-level env configuration.
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    REED_API_KEY: process.env.REED_API_KEY,
    BROWSERLESS_WS_URL: process.env.BROWSERLESS_WS_URL,
  },
};

export default nextConfig;
