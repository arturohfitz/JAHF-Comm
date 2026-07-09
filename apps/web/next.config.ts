import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@jahf-comm/db", "@jahf-comm/shared"]
};

export default nextConfig;
