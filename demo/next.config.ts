import type { NextConfig } from "next";
import path from "path";

// The demo app imports the off-ledger client (crypto, model bindings, the ledger
// client, and the compression scenarios) from the sibling `app/` package, installed
// as a local file: dependency (see package.json). Turbopack's file watching is
// widened to the repository root so edits to the linked package are picked up.
const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
