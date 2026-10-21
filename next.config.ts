import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg", "snowflake-sdk"],
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;
