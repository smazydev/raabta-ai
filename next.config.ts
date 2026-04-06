import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Helps `pg` on Vercel serverless (avoid over-bundling the native driver graph).
  serverExternalPackages: ["pg"],
};

export default nextConfig;
