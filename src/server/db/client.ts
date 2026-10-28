// OWNER: F. One Drizzle database behind two drivers:
//   DATABASE_URL set → node-postgres pool
//   unset            → PGlite (embedded Postgres): .data/pglite on disk, in memory when NODE_ENV=test
// Migrations from drizzle/ are applied and seed rows inserted on first use. The instance is a
// globalThis singleton so Next dev hot reloads reuse it.
//
// RULE: inside db.transaction(async (tx) => …) use only `tx`. PGlite is a single connection that
// queues every query behind the open transaction, so touching the outer db there would deadlock;
// the PGlite client throws a descriptive error instead (see guardPglite).
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { CONFIG_DEFAULTS } from "../config-defaults";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Accept either in helpers that can run inside or outside a transaction. */
export type DbOrTx = Database | Tx;
export type DbDriver = "pg" | "pglite";

interface DbHandle {
  db: Database;
  driver: DbDriver;
  close: () => Promise<void>;
}

const g = globalThis as unknown as {
  __ktiDb?: Promise<DbHandle>;
  __ktiTestDb?: Database | null;
};

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");
const PGLITE_DIR = path.join(process.cwd(), ".data", "pglite");

/** The shared database, migrated and seeded. */
export async function getDb(): Promise<Database> {
  if (g.__ktiTestDb) return g.__ktiTestDb;
  g.__ktiDb ??= open().catch((err) => {
    g.__ktiDb = undefined; // allow a retry on the next call
    throw err;
  });
  return (await g.__ktiDb).db;
}

export async function getDbDriver(): Promise<DbDriver> {
  if (g.__ktiTestDb) return "pglite";
  await getDb();
  return (await g.__ktiDb!).driver;
}

/** Close the shared database (scripts, test teardown). */
export async function closeDb(): Promise<void> {
  const handle = g.__ktiDb;
  g.__ktiDb = undefined;
  if (handle) await (await handle).close();
}

/**
 * A fresh, isolated in-memory PGlite database (migrated + seeded). Pair with setTestDb() so code
 * calling getDb() uses it:
 *   beforeEach(async () => setTestDb(await createTestDb()));
 */
export async function createTestDb(): Promise<Database> {
  const handle = await openPglite(undefined);
  return handle.db;
}

/** Route getDb() to `db` (tests). Pass null to restore the shared instance. */
export function setTestDb(db: Database | null): void {
  g.__ktiTestDb = db;
}

async function open(): Promise<DbHandle> {
  const url = process.env.DATABASE_URL;
  if (url) return openPg(url);
  if (process.env.NODE_ENV === "test") return openPglite(undefined);
  mkdirSync(PGLITE_DIR, { recursive: true });
  return openPglite(PGLITE_DIR);
}

async function openPg(url: string): Promise<DbHandle> {
  const [{ Pool }, { drizzle }, { migrate }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
    import("drizzle-orm/node-postgres/migrator"),
  ]);
  const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  pool.on("error", (err) => console.error("[db] idle client error", err));
  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  const typed = db as unknown as Database;
  await seed(typed);
  return { db: typed, driver: "pg", close: () => pool.end() };
}

async function openPglite(dataDir: string | undefined): Promise<DbHandle> {
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const client = new PGlite(dataDir);
  await client.waitReady;
  guardPglite(client);
  const db = drizzle({ client, schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  const typed = db as unknown as Database;
  await seed(typed);
  return { db: typed, driver: "pglite", close: () => client.close() };
}

/**
 * PGlite already serializes everything: query(), exec() and transaction() all wait on one internal
 * mutex, so concurrent transactions queue instead of interleaving (proven by db.test.ts). The one
 * hazard is calling the outer client while a transaction is open in the same async flow — that
 * waits on the transaction it is part of, forever. Detect it and fail fast with a clear message.
 */
function guardPglite(client: PGlite): void {
  const openTx = new AsyncLocalStorage<{ open: boolean }>();
  const fail = (what: string) => {
    throw new Error(
      `[db] ${what} on the outer database while a transaction is open in the same call chain. ` +
        "Use the transaction's `tx` instead (this would deadlock on PGlite).",
    );
  };
  const c = client as unknown as Record<"query" | "exec" | "transaction", (...args: unknown[]) => Promise<unknown>>;
  for (const method of ["query", "exec"] as const) {
    const original = c[method].bind(client);
    c[method] = (...args) => {
      if (openTx.getStore()?.open) fail(method);
      return original(...args);
    };
  }
  const originalTx = c.transaction.bind(client);
  c.transaction = (...args) => {
    if (openTx.getStore()?.open) fail("transaction");
    const marker = { open: true };
    return openTx.run(marker, () => originalTx(...args)).finally(() => {
      marker.open = false;
    });
  };
}

async function seed(db: Database): Promise<void> {
  await db
    .insert(schema.thrones)
    .values([{ id: "eternal" }, { id: "daily" }])
    .onConflictDoNothing();
  await db
    .insert(schema.config)
    .values(Object.entries(CONFIG_DEFAULTS).map(([key, value]) => ({ key, value })))
    .onConflictDoNothing();
}
