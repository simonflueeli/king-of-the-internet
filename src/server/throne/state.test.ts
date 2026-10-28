import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { titleFor } from "@/lib/pricing";
import type { ThroneId } from "@/lib/contracts";
import { resetClock, setNow } from "../clock";
import { createTestDb, setTestDb, type Database } from "../db/client";
import { reigns, thrones } from "../db/schema";
import { removeCurrentKing } from "./admin-ops";
import { getReign, getThroneState } from "./state";

let db: Database;

/** Minimal crowning for tests (C's real crown transaction also handles reservations/payments). */
async function crown(throne: ThroneId, name: string, paidCents: number, at: Date) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(thrones).where(eq(thrones.id, throne)).for("update");
    if (row.currentReignId) {
      await tx.update(reigns).set({ endedAt: at, endReason: "takeover" }).where(eq(reigns.id, row.currentReignId));
    }
    const [reign] = await tx
      .insert(reigns)
      .values({ throneId: throne, name, paidCents, title: titleFor(paidCents), crestSeed: 0, startedAt: at })
      .returning();
    await tx
      .update(thrones)
      .set({ currentReignId: reign.id, lastPaidCents: paidCents, crownedAt: at, version: row.version + 1 })
      .where(eq(thrones.id, throne));
    return reign;
  });
}

describe("getThroneState", () => {
  beforeEach(async () => {
    db = await createTestDb();
    setTestDb(db);
  });
  afterAll(() => {
    setTestDb(null);
    resetClock();
  });

  it("vacant never-taken throne", async () => {
    setNow("2026-03-01T12:00:00Z");
    const s = await getThroneState("eternal");
    expect(s.king).toBeNull();
    expect(s.vacancy).toEqual({ reason: "never", yesterdayRuler: null });
    expect(s.minCents).toBe(200);
    expect(s.nextMinCentsAtMinimum).toBe(220);
    expect(s.stats.reignCount).toBe(0);
    expect(s.resetsAt).toBeNull();
    expect(s.serverNow).toBe("2026-03-01T12:00:00.000Z");
  });

  it("AC-05: €150 → Duke, next minimum €165.00, hall shows the reign", async () => {
    setNow("2026-03-01T12:00:00Z");
    await crown("eternal", "Max", 15_000, new Date("2026-03-01T12:00:00Z"));
    setNow("2026-03-01T12:10:00Z");
    const s = await getThroneState("eternal");
    expect(s.king?.name).toBe("Max");
    expect(s.king?.title).toBe("Duke");
    expect(s.king?.lengthMs).toBe(600_000);
    expect(s.minCents).toBe(16_500);
    expect(s.recent.map((r) => `${r.title} ${r.name}`)).toEqual(["Duke Max"]);
    expect(s.stats.totalPaidCents).toBe(15_000);
    expect(s.version).toBe(1);
  });

  it("AC-04: daily king crowned 23:59 → vacant with yesterday's ruler after 00:00 UTC", async () => {
    setNow("2026-03-01T23:59:00Z");
    await crown("daily", "Night Owl", 5_000, new Date("2026-03-01T23:59:00Z"));
    expect((await getThroneState("daily")).minCents).toBe(5_500);

    setNow("2026-03-02T00:00:01Z");
    const s = await getThroneState("daily");
    expect(s.king).toBeNull();
    expect(s.vacancy).toEqual({ reason: "reset", yesterdayRuler: "Night Owl" });
    expect(s.minCents).toBe(200);
    expect(s.stats.reignCount).toBe(0);
    expect(s.stats.totalPaidCents).toBe(0);
    expect(s.recent).toEqual([]);
    expect(s.resetsAt).toBe("2026-03-03T00:00:00.000Z");
  });

  it("removal keeps the price and shows the removed vacancy; hidden reigns are excluded", async () => {
    setNow("2026-03-01T12:00:00Z");
    const reign = await crown("eternal", "Spammer", 1_000, new Date("2026-03-01T12:00:00Z"));
    await removeCurrentKing("eternal", { reason: "removed", reasonCategory: "spam", actor: "test" });
    await db.update(reigns).set({ hidden: true }).where(eq(reigns.id, reign.id));
    const s = await getThroneState("eternal");
    expect(s.king).toBeNull();
    expect(s.vacancy?.reason).toBe("removed");
    expect(s.minCents).toBe(1_100);
    expect(s.recent).toEqual([]);
    expect(s.version).toBe(2);
    const shared = await getReign(reign.id);
    expect(shared).toMatchObject({ hidden: true, name: "", endReason: "removed" });
  });
});
