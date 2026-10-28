import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".claude/**", ".next/**", ".data/**"],
    // PGlite instances boot in ~1 s each; give DB tests room on slow machines.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
