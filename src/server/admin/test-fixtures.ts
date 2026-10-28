// OWNER: S. Test fixtures: crown a king the way C's crown transaction leaves the DB
// (completed reservation → payment → reign → throne row), without going through payments.
import { eq } from "drizzle-orm";
import type { Stripe } from "stripe";
import type { ThroneId } from "@/lib/contracts";
import { titleFor } from "@/lib/pricing";
import { now } from "../clock";
import { getDb } from "../db/client";
import { payments, reigns, reservations, thrones } from "../db/schema";

let seq = 0;

export async function crownWithPayment(
  throne: ThroneId,
  name: string,
  paidCents: number,
  opts: { email?: string; fingerprint?: string | null; proclamation?: string } = {},
) {
  const db = await getDb();
  const n = ++seq;
  const at = now();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(thrones).where(eq(thrones.id, throne)).for("update");
    const [res] = await tx
      .insert(reservations)
      .values({
        throneId: throne,
        minCents: paidCents,
        amountCents: paidCents,
        throneVersion: row.version,
        state: "completed",
        expiresAt: at,
        reservationTokenHash: `test-${n}`,
        paymentIntentId: `pi_test_${n}`,
        name,
        proclamation: opts.proclamation ?? null,
        email: opts.email ?? `buyer${n}@example.com`,
        termsAcceptedAt: at,
      })
      .returning();
    const [payment] = await tx
      .insert(payments)
      .values({
        reservationId: res.id,
        stripePaymentIntentId: `pi_test_${n}`,
        stripeChargeId: `ch_test_${n}`,
        amountCents: paidCents,
        status: "succeeded",
        feeCents: Math.round(paidCents * 0.03),
        cardFingerprint: opts.fingerprint === undefined ? `fp_test_${n}` : opts.fingerprint,
      })
      .returning();
    if (row.currentReignId) {
      await tx.update(reigns).set({ endedAt: at, endReason: "takeover" }).where(eq(reigns.id, row.currentReignId));
    }
    const [reign] = await tx
      .insert(reigns)
      .values({
        throneId: throne,
        name,
        proclamation: opts.proclamation ?? null,
        paidCents,
        title: titleFor(paidCents),
        crestSeed: 0,
        startedAt: at,
        paymentId: payment.id,
      })
      .returning();
    await tx.update(reservations).set({ reignId: reign.id }).where(eq(reservations.id, res.id));
    await tx
      .update(thrones)
      .set({ currentReignId: reign.id, lastPaidCents: paidCents, crownedAt: at, version: row.version + 1 })
      .where(eq(thrones.id, throne));
    return { reign, payment, reservation: res };
  });
}

/** Minimal Stripe event wrapper for handler tests. */
export function stripeEvent(type: string, object: Record<string, unknown>): Stripe.Event {
  return { id: `evt_${++seq}`, object: "event", type, data: { object } } as unknown as Stripe.Event;
}
