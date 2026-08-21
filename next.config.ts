import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright must not be bundled — it loads its native browser launcher
  serverExternalPackages: ["playwright"],
};

export default nextConfig;
