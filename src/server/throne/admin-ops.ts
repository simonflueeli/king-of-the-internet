// OWNER: C. Throne mutations used by S (admin console, disputes, refunds, reports). Signatures are
// a cross-workstream contract (docs/ARCHITECTURE.md). Each mutation locks the throne row, bumps its
// version, writes audit_log and broadcasts throne.updated after commit.
//
// None of these invalidate an open checkout: bumpVersion() carries the open reservation's version
// snapshot along, so a buyer who is paying right now still gets crowned (the price is unchanged).
import { eq } from "drizzle-orm";
import type { EndReason, ThroneId } from "@/lib/contracts";
import { publish } from "../bus";
import { now as clockNow } from "../clock";
import { getDb } from "../db/client";
import { auditLog, reigns } from "../db/schema";
import { bumpVersion, lockThrone } from "./common";
import { getThroneState } from "./state";

export async function removeCurrentKing(
  throne: ThroneId,
  opts: { reason: EndReason; reasonCategory: string; actor: string; reignId?: string },
): Promise<{ removedReignId: string | null }> {
  const db = await getDb();
  const removedReignId = await db.transaction(async (tx) => {
    const row = await lockThrone(tx, throne);
    if (!row.currentReignId) return null;
    if (opts.reignId && opts.reignId !== row.currentReignId) return null; // that reign is no longer current
    const now = clockNow();
    await tx
      .update(reigns)
      .set({ endedAt: now, endReason: opts.reason })
      .where(eq(reigns.id, row.currentReignId));
    // The price stays where it is: last_paid_cents and crowned_at are untouched.
    const version = await bumpVersion(tx, row, now, { currentReignId: null, removedAt: now });
    await tx.insert(auditLog).values({
      actor: opts.actor,
      action: "throne.remove_king",
      target: row.currentReignId,
      before: { throne, reignId: row.currentReignId, version: row.version },
      after: { reason: opts.reason, reasonCategory: opts.reasonCategory, version },
      createdAt: now,
    });
    return row.currentReignId;
  });
  if (removedReignId) await broadcastThrone(throne);
  return { removedReignId };
}

export async function setReignHidden(reignId: string, hidden: boolean, actor: string): Promise<void> {
  const db = await getDb();
  const throne = await db.transaction(async (tx) => {
    const [peek] = await tx.select({ throneId: reigns.throneId }).from(reigns).where(eq(reigns.id, reignId));
    if (!peek) return null;
    const row = await lockThrone(tx, peek.throneId);
    const [reign] = await tx.select().from(reigns).where(eq(reigns.id, reignId));
    const now = clockNow();
    await tx.update(reigns).set({ hidden }).where(eq(reigns.id, reignId));
    await bumpVersion(tx, row, now);
    await tx.insert(auditLog).values({
      actor,
      action: hidden ? "reign.hide" : "reign.unhide",
      target: reignId,
      before: { hidden: reign.hidden },
      after: { hidden },
      createdAt: now,
    });
    return reign.throneId;
  });
  if (throne) await broadcastThrone(throne);
}

export async function setReignBlurred(reignId: string, blurred: boolean): Promise<void> {
  const db = await getDb();
  const throne = await db.transaction(async (tx) => {
    const [peek] = await tx.select({ throneId: reigns.throneId }).from(reigns).where(eq(reigns.id, reignId));
    if (!peek) return null;
    const row = await lockThrone(tx, peek.throneId);
    const [reign] = await tx.select().from(reigns).where(eq(reigns.id, reignId));
    if (reign.blurred === blurred) return null;
    const now = clockNow();
    await tx.update(reigns).set({ blurred }).where(eq(reigns.id, reignId));
    await bumpVersion(tx, row, now);
    await tx.insert(auditLog).values({
      actor: "system",
      action: blurred ? "reign.blur" : "reign.unblur",
      target: reignId,
      before: { blurred: reign.blurred },
      after: { blurred },
      createdAt: now,
    });
    return reign.throneId;
  });
  if (throne) await broadcastThrone(throne);
}

/** Recompute the throne state and publish throne.updated. */
export async function broadcastThrone(throne: ThroneId): Promise<void> {
  publish(throne, { type: "throne.updated", data: await getThroneState(throne) });
}
