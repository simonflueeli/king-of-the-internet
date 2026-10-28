import { defineConfig } from "drizzle-kit";

// `npm run db:generate` only diffs schema.ts against drizzle/ snapshots; it needs no database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
});
