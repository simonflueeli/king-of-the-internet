import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crownWithPayment, stripeEvent } from "./admin/test-fixtures";
import { checkBans } from "./bans";
import { advance, resetClock, setNow } from "./clock";
import { createTestDb, setTestDb, type Database } from "./db/client";
import { auditLog, payments, reigns, thrones } from "./db/schema";
import { applyRefund, handleChargeRefunded, handleDisputeClosed, handleDisputeCreated } from "./disputes";
import * as notifications from "./notifications";
import { getThroneState } from "./throne/state";

let db: Database;

describe("disputes and refunds", () => {
  beforeEach(async () => {
    db = await createTestDb();
    setTestDb(db);
    setNow("2026-03-01T12:00:00Z");
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => {
    setTestDb(null);
    resetClock();
  });

  it("AC-18: dispute on the current reign → king removed, reign disputed, fingerprint + email banned, price unchanged", async () => {
    const { reign, payment } = await crownWithPayment("eternal", "Max", 10_000, {
      email: "Max@Example.com",
      fingerprint: "fp_abc",
    });
    advance(60_000);
    const before = await getThroneState("eternal");
    expect(before.king?.id).toBe(reign.id);

    await handleDisputeCreated(
      stripeEvent("charge.dispute.created", {
        id: "dp_1",
        object: "dispute",
        charge: payment.stripeChargeId,
        payment_intent: payment.stripePaymentIntentId,
        reason: "fraudulent",
        status: "needs_response",
      }),
    );

    const after = await getThroneState("eternal");
    expect(after.king).toBeNull();
    expect(after.vacancy?.reason).toBe("removed");
    expect(after.minCents).toBe(before.minCents); // price unchanged
    expect(after.minCents).toBe(11_000);

    const [r] = await db.select().from(reigns).where(eq(reigns.id, reign.id));
    expect(r.endReason).toBe("disputed");
    const [p] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(p).toMatchObject({ disputed: true, status: "disputed" });
    const [t] = await db.select().from(thrones).where(eq(thrones.id, "eternal"));
    expect(t.lastPaidCents).toBe(10_000);

    expect(await checkBans({ cardFingerprint: "fp_abc" })).toMatchObject({ banned: true });
    expect(await checkBans({ email: "  max@example.COM " })).toMatchObject({ banned: true });
    expect(await checkBans({ cardFingerprint: "fp_other", email: "other@example.com" })).toEqual({ banned: false });

    const actions = (await db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["payment.dispute_created", "throne.remove_king", "ban.create"]));
  });

  it("dispute on a past reign: payment disputed and bans, current king stays", async () => {
    const old = await crownWithPayment("eternal", "Old", 200, { fingerprint: "fp_old" });
    advance(1000);
    const cur = await crownWithPayment("eternal", "Current", 220);
    await handleDisputeCreated(stripeEvent("charge.dispute.created", { id: "dp_2", charge: old.payment.stripeChargeId }));
    expect((await getThroneState("eternal")).king?.id).toBe(cur.reign.id);
    const [p] = await db.select().from(payments).where(eq(payments.id, old.payment.id));
    expect(p.disputed).toBe(true);
    expect(await checkBans({ cardFingerprint: "fp_old" })).toMatchObject({ banned: true });
  });

  it("handlers are safe to run twice", async () => {
    const { payment } = await crownWithPayment("daily", "Twice", 500, { fingerprint: "fp_twice" });
    const ev = stripeEvent("charge.dispute.created", { id: "dp_3", charge: payment.stripeChargeId });
    await handleDisputeCreated(ev);
    await handleDisputeCreated(ev);
    const bans = (await db.select().from(auditLog)).filter((a) => a.action === "ban.create");
    expect(bans).toHaveLength(2); // one card, one email
  });

  it("dispute closed updates the payment status", async () => {
    const { payment } = await crownWithPayment("eternal", "Won", 300);
    await handleDisputeClosed(stripeEvent("charge.dispute.closed", { id: "dp_4", charge: payment.stripeChargeId, status: "won" }));
    const [p] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(p.status).toBe("dispute_won");
  });

  it("charge.refunded of the current reign removes the king and notifies once", async () => {
    const spy = vi.spyOn(notifications, "onRefundIssued").mockResolvedValue();
    const { reign, payment } = await crownWithPayment("eternal", "Refunded", 1_000);
    const ev = stripeEvent("charge.refunded", {
      id: payment.stripeChargeId,
      object: "charge",
      payment_intent: payment.stripePaymentIntentId,
      amount_refunded: 400,
    });
    await handleChargeRefunded(ev);
    await handleChargeRefunded(ev); // duplicate delivery: no double count
    const [p] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(p).toMatchObject({ refundedCents: 400, status: "partially_refunded" });
    const [r] = await db.select().from(reigns).where(eq(reigns.id, reign.id));
    expect(r.endReason).toBe("refunded");
    expect((await getThroneState("eternal")).minCents).toBe(1_100);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ reignId: reign.id, amountCents: 400 });
  });

  it("applyRefund is absolute: an admin refund followed by the webhook counts once", async () => {
    const spy = vi.spyOn(notifications, "onRefundIssued").mockResolvedValue();
    const { payment } = await crownWithPayment("daily", "Admin", 800);
    expect((await applyRefund(payment.id, 800, "admin@localhost")).changed).toBe(true);
    expect((await applyRefund(payment.id, 800, "stripe")).changed).toBe(false);
    const [p] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(p).toMatchObject({ refundedCents: 800, status: "refunded" });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
