// OWNER: C. F ships a simple working version; C owns correctness from here on.
// Each mutation locks the throne row, bumps its version, writes audit_log and broadcasts.
import { eq } from "drizzle-orm";
import type { EndReason, ThroneId } from "@/lib/contracts";
import { publish } from "../bus";
import { now as clockNow } from "../clock";
import { getDb } from "../db/client";
import { auditLog, reigns, thrones } from "../db/schema";
import { getThroneState } from "./state";

export async function removeCurrentKing(
  throne: ThroneId,
  opts: { reason: EndReason; reasonCategory: string; actor: string; reignId?: string },
): Promise<{ removedReignId: string | null }> {
  const db = await getDb();
  const removedReignId = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(thrones).where(eq(thrones.id, throne)).for("update");
    if (!row?.currentReignId) return null;
    if (opts.reignId && opts.reignId !== row.currentReignId) return null; // that reign is no longer current
    const now = clockNow();
    await tx
      .update(reigns)
      .set({ endedAt: now, endReason: opts.reason })
      .where(eq(reigns.id, row.currentReignId));
    // The price stays where it is: last_paid_cents and crowned_at are untouched.
    await tx
      .update(thrones)
      .set({ currentReignId: null, removedAt: now, version: row.version + 1, updatedAt: now })
      .where(eq(thrones.id, throne));
    await tx.insert(auditLog).values({
      actor: opts.actor,
      action: "throne.remove_king",
      target: row.currentReignId,
      before: { throne, reignId: row.currentReignId, version: row.version },
      after: { reason: opts.reason, reasonCategory: opts.reasonCategory, version: row.version + 1 },
    });
    return row.currentReignId;
  });
  if (removedReignId) await broadcastThrone(throne);
  return { removedReignId };
}

export async function setReignHidden(reignId: string, hidden: boolean, actor: string): Promise<void> {
  const db = await getDb();
  const throne = await db.transaction(async (tx) => {
    const [reign] = await tx.select().from(reigns).where(eq(reigns.id, reignId));
    if (!reign) return null;
    const [row] = await tx.select().from(thrones).where(eq(thrones.id, reign.throneId)).for("update");
    await tx.update(reigns).set({ hidden }).where(eq(reigns.id, reignId));
    await tx.update(thrones).set({ version: row.version + 1, updatedAt: clockNow() }).where(eq(thrones.id, row.id));
    await tx.insert(auditLog).values({
      actor,
      action: hidden ? "reign.hide" : "reign.unhide",
      target: reignId,
      before: { hidden: reign.hidden },
      after: { hidden },
    });
    return reign.throneId;
  });
  if (throne) await broadcastThrone(throne);
}

export async function setReignBlurred(reignId: string, blurred: boolean): Promise<void> {
  const db = await getDb();
  const throne = await db.transaction(async (tx) => {
    const [reign] = await tx.select().from(reigns).where(eq(reigns.id, reignId));
    if (!reign || reign.blurred === blurred) return null;
    const [row] = await tx.select().from(thrones).where(eq(thrones.id, reign.throneId)).for("update");
    await tx.update(reigns).set({ blurred }).where(eq(reigns.id, reignId));
    await tx.update(thrones).set({ version: row.version + 1, updatedAt: clockNow() }).where(eq(thrones.id, row.id));
    await tx.insert(auditLog).values({
      actor: "system",
      action: blurred ? "reign.blur" : "reign.unblur",
      target: reignId,
      before: { blurred: reign.blurred },
      after: { blurred },
    });
    return reign.throneId;
  });
  if (throne) await broadcastThrone(throne);
}

/** Recompute the throne state and publish throne.updated. */
export async function broadcastThrone(throne: ThroneId): Promise<void> {
  publish(throne, { type: "throne.updated", data: await getThroneState(throne) });
}
