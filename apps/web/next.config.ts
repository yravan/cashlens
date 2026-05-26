import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@cashlens/api-types"],
};

export default nextConfig;
