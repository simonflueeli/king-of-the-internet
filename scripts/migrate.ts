// `npm run db:migrate` — apply drizzle/ migrations and seed rows to DATABASE_URL, or to the
// local PGlite database (.data/pglite) when it is unset. The app also does this on first DB use.
import { closeDb, getDb, getDbDriver } from "../src/server/db/client";

async function main() {
  await getDb();
  console.log(`Database migrated and seeded (${await getDbDriver()}).`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
