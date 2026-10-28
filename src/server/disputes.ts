// OWNER: S. Chargebacks and refunds (PRD "Chargebacks and refunds"). C's Stripe webhook route
// dispatches charge.dispute.created / charge.dispute.closed / charge.refunded here (after its
// stripe_events idempotency check). Handlers are also safe to run twice.
//
//   dispute created → payment disputed; if the reign is current, remove the king (reason
//                     "disputed"); ban card fingerprint + email. The price stays where it is (AC-18).
//   dispute closed  → payment status dispute_won / dispute_lost / …
//   charge refunded → payment refunded_cents/status; a refund of the current reign removes the king.
import { eq, or } from "drizzle-orm";
import type { Stripe } from "stripe";
import { createBan } from "./bans";
import { now as clockNow } from "./clock";
import { getDb } from "./db/client";
import { auditLog, customers, payments, reigns, reservations } from "./db/schema";
import { onRefundIssued } from "./notifications";
import { removeCurrentKing } from "./throne/admin-ops";

type PaymentRow = typeof payments.$inferSelect;
type ReignRow = typeof reigns.$inferSelect;

const idOf = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : (v?.id ?? null);

/** The payment for a Stripe charge / PaymentIntent (fake mode stores fake ids in the same columns). */
export async function findPayment(ref: { chargeId?: string | null; intentId?: string | null }): Promise<PaymentRow | null> {
  const conds = [
    ref.intentId ? eq(payments.stripePaymentIntentId, ref.intentId) : undefined,
    ref.chargeId ? eq(payments.stripeChargeId, ref.chargeId) : undefined,
  ].filter((c) => c !== undefined);
  if (!conds.length) return null;
  const db = await getDb();
  const [row] = await db.select().from(payments).where(or(...conds)).limit(1);
  return row ?? null;
}

/** The reign bought with a payment (reigns.payment_id, else reservations.reign_id). */
export async function reignForPayment(payment: PaymentRow): Promise<ReignRow | null> {
  const db = await getDb();
  const [byPayment] = await db.select().from(reigns).where(eq(reigns.paymentId, payment.id)).limit(1);
  if (byPayment) return byPayment;
  const [res] = await db
    .select({ reignId: reservations.reignId })
    .from(reservations)
    .where(eq(reservations.id, payment.reservationId));
  if (!res?.reignId) return null;
  const [byReservation] = await db.select().from(reigns).where(eq(reigns.id, res.reignId));
  return byReservation ?? null;
}

/** Buyer email for a payment: reservation email, else the reign's customer. */
async function buyerEmail(payment: PaymentRow, reign: ReignRow | null): Promise<string | null> {
  const db = await getDb();
  const [res] = await db.select({ email: reservations.email }).from(reservations).where(eq(reservations.id, payment.reservationId));
  if (res?.email) return res.email;
  if (!reign?.customerId) return null;
  const [c] = await db.select({ email: customers.email }).from(customers).where(eq(customers.id, reign.customerId));
  return c?.email ?? null;
}

// ---------------------------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------------------------

export async function handleDisputeCreated(event: Stripe.Event): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute;
  const charge = typeof dispute.charge === "object" ? dispute.charge : null;
  const payment = await findPayment({
    chargeId: idOf(dispute.charge),
    intentId: idOf(dispute.payment_intent) ?? idOf(charge?.payment_intent),
  });
  if (!payment) {
    console.error("[disputes] dispute for unknown payment", { eventId: event.id, dispute: dispute.id });
    return;
  }

  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({ disputed: true, status: "disputed", updatedAt: clockNow() })
      .where(eq(payments.id, payment.id));
    await tx.insert(auditLog).values({
      actor: "stripe",
      action: "payment.dispute_created",
      target: payment.id,
      before: { status: payment.status, disputed: payment.disputed },
      after: { status: "disputed", disputed: true, dispute: dispute.id, reason: dispute.reason ?? null },
    });
  });

  const reign = await reignForPayment(payment);
  if (reign) {
    // Only removes when that reign is still current; last_paid_cents/crowned_at stay untouched.
    await removeCurrentKing(reign.throneId, {
      reason: "disputed",
      reasonCategory: "chargeback",
      actor: "stripe",
      reignId: reign.id,
    });
  }

  const fingerprint = payment.cardFingerprint ?? charge?.payment_method_details?.card?.fingerprint ?? null;
  const email = (await buyerEmail(payment, reign)) ?? charge?.billing_details?.email ?? null;
  const reason = `chargeback ${dispute.id}`;
  if (fingerprint) await createBan({ kind: "card", value: fingerprint, reason, actor: "stripe" });
  if (email) await createBan({ kind: "email", value: email, reason, actor: "stripe" });
}

export async function handleDisputeClosed(event: Stripe.Event): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute;
  const payment = await findPayment({ chargeId: idOf(dispute.charge), intentId: idOf(dispute.payment_intent) });
  if (!payment) {
    console.error("[disputes] closed dispute for unknown payment", { eventId: event.id, dispute: dispute.id });
    return;
  }
  const status = `dispute_${dispute.status}`; // dispute_won | dispute_lost | dispute_warning_closed …
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(payments).set({ status, disputed: true, updatedAt: clockNow() }).where(eq(payments.id, payment.id));
    await tx.insert(auditLog).values({
      actor: "stripe",
      action: "payment.dispute_closed",
      target: payment.id,
      before: { status: payment.status },
      after: { status, dispute: dispute.id },
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------------------------

export async function handleChargeRefunded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const payment = await findPayment({ chargeId: charge.id, intentId: idOf(charge.payment_intent) });
  if (!payment) {
    console.error("[disputes] refund for unknown payment", { eventId: event.id, charge: charge.id });
    return;
  }
  await applyRefund(payment.id, charge.amount_refunded, "stripe");
}

/**
 * Records that `totalRefundedCents` of a payment have been refunded (absolute, so the admin call and
 * the later charge.refunded webhook do not double count). Removes the king if the reign is current
 * and notifies the buyer once per increase.
 */
export async function applyRefund(
  paymentId: string,
  totalRefundedCents: number,
  actor: string,
): Promise<{ changed: boolean; removedReignId: string | null }> {
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!p) return null;
    const total = Math.min(totalRefundedCents, p.amountCents);
    if (total <= p.refundedCents) return { payment: p, delta: 0 };
    const status = p.disputed ? p.status : total >= p.amountCents ? "refunded" : "partially_refunded";
    await tx.update(payments).set({ refundedCents: total, status, updatedAt: clockNow() }).where(eq(payments.id, p.id));
    await tx.insert(auditLog).values({
      actor,
      action: "payment.refund",
      target: p.id,
      before: { refundedCents: p.refundedCents, status: p.status },
      after: { refundedCents: total, status },
    });
    return { payment: p, delta: total - p.refundedCents };
  });
  if (!result || result.delta === 0) return { changed: false, removedReignId: null };

  const reign = await reignForPayment(result.payment);
  let removedReignId: string | null = null;
  if (reign) {
    ({ removedReignId } = await removeCurrentKing(reign.throneId, {
      reason: "refunded",
      reasonCategory: "refund",
      actor,
      reignId: reign.id,
    }));
    onRefundIssued({ reignId: reign.id, amountCents: result.delta }).catch((err) =>
      console.error("[disputes] onRefundIssued failed", err),
    );
  }
  return { changed: true, removedReignId };
}
