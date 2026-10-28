import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is deliberately off: almost every page and route reads live DB state.
  // Pages that read the DB call `await connection()` (next/server) so they are rendered per request.
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  // The OG image routes read the bundled TTFs with fs at runtime; keep them in traced deployments
  // (Vercel, output: "standalone").
  outputFileTracingIncludes: { "/og/**": ["./src/app/og/_fonts/**"] },
  // Inlined at build time so production builds can drop the mock-API code (?mock=1) statically.
  env: { NEXT_PUBLIC_MOCK_API: process.env.NEXT_PUBLIC_MOCK_API ?? "" },
};

export default nextConfig;
