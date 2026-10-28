// OWNER: C. Capture and crown (PRD "Checkout and payment" → Flow, "Capture and crown").
//
// handleAuthorized() is the single code path behind the Stripe webhook
// (payment_intent.amount_capturable_updated / .succeeded), POST /api/dev/fake-pay and the
// reconcile job. Under the throne row lock it checks that the reservation is paying and unexpired,
// that the throne version is unchanged and that the authorized amount matches; then it captures
// (idempotency key = reservation id) and, in the same transaction, inserts the reign, ends the
// previous one, updates the throne (+version), completes the reservation and records the payment.
// Any failed check voids the PaymentIntent after commit, so nobody is charged without a takeover.
import { eq } from "drizzle-orm";
import type { FailReason, ReservationState, ThroneId } from "@/lib/contracts";
import { crestHash } from "@/lib/crest";
import { isValidAmount, titleFor } from "@/lib/pricing";
import { checkBans } from "../bans";
import { now as clockNow } from "../clock";
import { getConfig, pricingConfig } from "../config";
import { getDb } from "../db/client";
import { customers, payments, reigns, reservations } from "../db/schema";
import { onTakeoverCommitted } from "../notifications";
import { getPaymentProvider, type IntentStatus } from "../payments/provider";
import { broadcastThrone } from "./admin-ops";
import {
  announceEnded,
  bumpVersion,
  endReservation,
  lockThrone,
  publishReservationResult,
  publishReservationUpdated,
  settleEnded,
  voidIntent,
  type ReservationRow,
} from "./common";
import { deadReason, isOpenState } from "./rules";
import { utcDayStart } from "./state";

export type CrownOutcome =
  | { outcome: "crowned"; reservationId: string; reignId: string; throne: ThroneId }
  | { outcome: "duplicate"; reservationId: string; reignId: string | null }
  | { outcome: "rejected"; reservationId: string; state: ReservationState; failReason: FailReason | null }
  | { outcome: "ignored"; reason: string };

async function findByIntent(paymentIntentId: string): Promise<ReservationRow | null> {
  const db = await getDb();
  const [r] = await db.select().from(reservations).where(eq(reservations.paymentIntentId, paymentIntentId)).limit(1);
  return r ?? null;
}

export async function handleAuthorized(paymentIntentId: string): Promise<CrownOutcome> {
  const r0 = await findByIntent(paymentIntentId);
  if (!r0) return { outcome: "ignored", reason: "unknown_intent" };
  if (r0.state === "completed") return { outcome: "duplicate", reservationId: r0.id, reignId: r0.reignId };

  const provider = getPaymentProvider();
  const intent = await provider.retrieve(paymentIntentId);
  // Only an authorized (or, after a crash between capture and commit, already captured) intent can crown.
  if (intent.status !== "requires_capture" && intent.status !== "succeeded") {
    return { outcome: "ignored", reason: `intent_${intent.status}` };
  }

  // Card bans can only be checked once a card is known (after authorization), so before capture.
  // checkBans reads the DB, so it runs before the transaction opens.
  const cardBanned = intent.cardFingerprint ? (await checkBans({ cardFingerprint: intent.cardFingerprint })).banned : false;

  const cfg = await getConfig();
  const pricing = pricingConfig(cfg);
  const db = await getDb();

  type TxResult =
    | { kind: "duplicate"; r: ReservationRow }
    | { kind: "rejected"; r: ReservationRow }
    | { kind: "crowned"; r: ReservationRow; reignId: string; previousReignId: string | null };

  const result = await db.transaction(async (tx): Promise<TxResult> => {
    const throne = await lockThrone(tx, r0.throneId);
    const now = clockNow();
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, r0.id));
    if (r.state === "completed") return { kind: "duplicate", r };

    const reject = async (state: "expired" | "failed", failReason: FailReason): Promise<TxResult> => {
      const ended = await endReservation(tx, r.id, state, failReason, now);
      return { kind: "rejected", r: ended ?? r };
    };

    // --- checks -------------------------------------------------------------------------------
    if (!isOpenState(r.state)) {
      // Authorized after the reservation had already ended (AC-09): void it. An expiry now reads
      // as "outbid" so the buyer is told their card wasn't charged.
      if (r.state === "expired" && r.failReason !== "outbid") {
        const [row] = await tx
          .update(reservations)
          .set({ failReason: "outbid", updatedAt: now })
          .where(eq(reservations.id, r.id))
          .returning();
        return { kind: "rejected", r: row };
      }
      return { kind: "rejected", r };
    }
    if (r.state === "active") return reject("failed", "canceled"); // authorized without our confirm
    if (cardBanned) return reject("failed", "banned");
    if (deadReason(r, cfg, now)) return reject("expired", "outbid");
    if (throne.version !== r.throneVersion) return reject("failed", "outbid");
    if (r.amountCents == null || !r.name || !isValidAmount(r.amountCents, r.minCents, pricing)) {
      return reject("failed", "canceled");
    }
    if (intent.status === "requires_capture" && intent.amountCapturable !== r.amountCents) {
      console.error("[crown] authorized amount mismatch", {
        reservationId: r.id,
        expected: r.amountCents,
        authorized: intent.amountCapturable,
      });
      return reject("failed", "canceled");
    }

    // --- capture ------------------------------------------------------------------------------
    let captured: Awaited<ReturnType<typeof provider.capture>>;
    try {
      captured = await provider.capture(paymentIntentId, r.id);
    } catch (err) {
      console.error("[crown] capture failed", { reservationId: r.id, paymentIntentId, err });
      return reject("failed", "capture_failed");
    }

    // --- crown (same transaction) -------------------------------------------------------------
    const [payment] = await tx
      .insert(payments)
      .values({
        reservationId: r.id,
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId: captured.chargeId,
        amountCents: r.amountCents,
        currency: cfg.currency,
        status: "succeeded",
        feeCents: captured.feeCents,
        cardFingerprint: captured.cardFingerprint ?? intent.cardFingerprint ?? null,
        cardCountry: intent.cardCountry ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: payments.id });

    let previousReignId: string | null = null;
    if (throne.currentReignId) {
      const [prev] = await tx.select().from(reigns).where(eq(reigns.id, throne.currentReignId));
      const dayStart = utcDayStart(now);
      if (prev && throne.id === "daily" && prev.startedAt < dayStart) {
        // Yesterday's daily king whose reset job has not run yet: the day ended their reign, not this buyer.
        await tx.update(reigns).set({ endedAt: dayStart, endReason: "reset" }).where(eq(reigns.id, prev.id));
      } else if (prev) {
        await tx.update(reigns).set({ endedAt: now, endReason: "takeover" }).where(eq(reigns.id, prev.id));
        previousReignId = prev.id;
      }
    }

    const [customer] = r.email
      ? await tx.select({ id: customers.id }).from(customers).where(eq(customers.email, r.email))
      : [];
    const [reign] = await tx
      .insert(reigns)
      .values({
        throneId: r.throneId,
        customerId: customer?.id ?? null,
        name: r.name,
        proclamation: r.proclamation || null,
        paidCents: r.amountCents,
        title: titleFor(r.amountCents),
        crestSeed: crestHash(r.name.toLowerCase()),
        startedAt: now,
        paymentId: payment.id,
        createdAt: now,
      })
      .returning({ id: reigns.id });

    await bumpVersion(
      tx,
      throne,
      now,
      { currentReignId: reign.id, lastPaidCents: r.amountCents, crownedAt: now, removedAt: null },
      { carryReservations: false },
    );
    const [done] = await tx
      .update(reservations)
      .set({ state: "completed", failReason: null, reignId: reign.id, updatedAt: now })
      .where(eq(reservations.id, r.id))
      .returning();
    return { kind: "crowned", r: done, reignId: reign.id, previousReignId };
  });

  // --- after commit -----------------------------------------------------------------------------
  if (result.kind === "duplicate") {
    return { outcome: "duplicate", reservationId: result.r.id, reignId: result.r.reignId };
  }
  if (result.kind === "rejected") {
    announceEnded(result.r);
    await voidIntent(paymentIntentId, { reservationId: result.r.id, failReason: result.r.failReason });
    return { outcome: "rejected", reservationId: result.r.id, state: result.r.state, failReason: result.r.failReason };
  }

  const throne = result.r.throneId;
  publishReservationResult(result.r);
  publishReservationUpdated(throne, null, null);
  await broadcastThrone(throne).catch((err) => console.error("[crown] broadcast failed", { throne, err }));
  // Fire and forget: emails must never delay or break the takeover. Started synchronously (G queues
  // the work in the background and returns), so flushNotifications() right after sees it.
  try {
    onTakeoverCommitted({ throne, reignId: result.reignId, previousReignId: result.previousReignId }).catch((err) =>
      console.error("[crown] onTakeoverCommitted failed", { reignId: result.reignId, err }),
    );
  } catch (err) {
    console.error("[crown] onTakeoverCommitted threw", { reignId: result.reignId, err });
  }
  return { outcome: "crowned", reservationId: result.r.id, reignId: result.reignId, throne };
}

/**
 * payment_intent.payment_failed (card declined, 3-D Secure failed). The reservation stays paying
 * until it expires so the buyer can try another card; the private result tells them it failed.
 */
export async function handlePaymentFailed(paymentIntentId: string): Promise<void> {
  const r = await findByIntent(paymentIntentId);
  if (!r || r.state !== "paying") return;
  const db = await getDb();
  const [row] = await db
    .update(reservations)
    .set({ failReason: "card_declined", updatedAt: clockNow() })
    .where(eq(reservations.id, r.id))
    .returning();
  if (row?.state === "paying") publishReservationResult(row);
}

/** payment_intent.canceled from outside our own void path (e.g. Stripe auto-cancel, dashboard). */
export async function handleIntentCanceled(paymentIntentId: string): Promise<void> {
  const r = await findByIntent(paymentIntentId);
  if (!r || !isOpenState(r.state)) return;
  const db = await getDb();
  const ended = await db.transaction(async (tx) => {
    await lockThrone(tx, r.throneId);
    return endReservation(tx, r.id, "failed", "canceled", clockNow());
  });
  if (ended) announceEnded(ended);
}

/**
 * Bring one paying reservation in line with the provider (reconcile job, AC-11): finish the
 * takeover when the money is authorized, end it when the intent was cancelled or the lock ran out.
 */
export async function reconcileReservation(r: ReservationRow): Promise<string> {
  const cfg = await getConfig();
  let status: IntentStatus | "missing" = "missing";
  if (r.paymentIntentId) {
    try {
      status = (await getPaymentProvider().retrieve(r.paymentIntentId)).status;
    } catch (err) {
      // Provider unreachable: leave it; the expire job ends it (and voids the intent) at expiry.
      console.error("[reconcile] retrieve failed", { reservationId: r.id, err });
      return "retrieve_failed";
    }
  }
  if ((status === "requires_capture" || status === "succeeded") && r.paymentIntentId) {
    return (await handleAuthorized(r.paymentIntentId)).outcome;
  }
  if (status === "canceled" && r.paymentIntentId) {
    await handleIntentCanceled(r.paymentIntentId);
    return "canceled";
  }
  // Still waiting for the buyer (3-D Secure, another card) — only act once the lock is gone.
  const reason = deadReason(r, cfg, clockNow());
  if (!reason && status !== "missing") return "pending";
  const db = await getDb();
  const ended = await db.transaction(async (tx) => {
    await lockThrone(tx, r.throneId);
    return endReservation(tx, r.id, reason ?? "failed", reason ?? "canceled", clockNow());
  });
  if (ended) await settleEnded([ended]);
  return ended ? ended.state : "noop";
}
