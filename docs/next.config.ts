import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a static export so the site can be served by any static host with no
  // Node runtime.
  output: "export",
};

export default nextConfig;
