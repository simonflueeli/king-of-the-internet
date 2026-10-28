import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS, getConfig, invalidateConfigCache, updateConfig } from "../config";
import { createTestDb, setTestDb, type Database } from "./client";
import { config, reservations, thrones } from "./schema";

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}

describe("database (PGlite)", () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDb();
    setTestDb(db);
  });
  afterAll(() => setTestDb(null));

  it("is migrated and seeded with both thrones and config defaults", async () => {
    const rows = await db.select().from(thrones).orderBy(thrones.id);
    expect(rows.map((r) => [r.id, r.version, r.currentReignId, r.lastPaidCents])).toEqual([
      ["daily", 0, null, null],
      ["eternal", 0, null, null],
    ]);
    const cfg = await db.select().from(config);
    expect(cfg.length).toBe(Object.keys(CONFIG_DEFAULTS).length);
  });

  it("serializes 50 concurrent reservation transactions: exactly one wins", async () => {
    const attempt = (i: number) =>
      db.transaction(async (tx) => {
        const [throne] = await tx.select().from(thrones).where(eq(thrones.id, "eternal")).for("update");
        await tx.insert(reservations).values({
          throneId: "eternal",
          minCents: 200,
          throneVersion: throne.version,
          state: "active",
          expiresAt: new Date(Date.now() + 180_000),
          reservationTokenHash: `token-${i}`,
        });
      });

    const results = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => attempt(i)));
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(49);
    expect(failed.every((r) => pgCode(r.reason) === "23505")).toBe(true);

    const open = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(reservations)
      .where(sql`${reservations.throneId} = 'eternal' and ${reservations.state} in ('active', 'paying')`);
    expect(open[0].n).toBe(1);

    // The other throne is independent; a finished reservation frees the slot.
    await db.update(reservations).set({ state: "released" }).where(eq(reservations.throneId, "eternal"));
    await expect(attempt(99)).resolves.toBeUndefined();
  });

  it("fails fast instead of deadlocking when the outer db is used inside a transaction", async () => {
    const err = await db
      .transaction(async () => {
        await db.select().from(thrones);
      })
      .catch((e: unknown) => e);
    // Drizzle wraps driver errors ("Failed query: …") and keeps the original as `cause`.
    expect(String((err as { cause?: unknown }).cause ?? err)).toMatch(/Use the transaction's `tx`/);
    // and the database is still usable afterwards
    await expect(db.select().from(thrones)).resolves.toHaveLength(2);
  });

  it("getConfig merges table values over defaults and updateConfig invalidates the cache", async () => {
    invalidateConfigCache();
    expect((await getConfig()).baseCents).toBe(200);
    const updated = await updateConfig({ baseCents: 300 }, "test");
    expect(updated.baseCents).toBe(300);
    await updateConfig({ baseCents: 200 }, "test");
    expect((await getConfig()).baseCents).toBe(200);
  });
});
