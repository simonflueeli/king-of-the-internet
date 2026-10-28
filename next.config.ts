import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is deliberately off: almost every page and route reads live DB state.
  // Pages that read the DB call `await connection()` (next/server) so they are rendered per request.
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
};

export default nextConfig;
