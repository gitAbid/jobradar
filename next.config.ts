import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright must not be bundled — it loads its native browser launcher
  serverExternalPackages: ["playwright"],
  // Build-time inlining: these are resolved from the build environment (a
  // deployment .env file or platform env vars) and baked into the server
  // bundle, so runtime works even without platform-level env configuration.
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    REED_API_KEY: process.env.REED_API_KEY,
  },
};

export default nextConfig;
