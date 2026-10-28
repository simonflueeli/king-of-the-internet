// Cross-workstream integration: a takeover through the real modules end to end.
// C reservation → S moderation (fake policy classifier) + bans → C crown → G onTakeoverCommitted →
// dev outbox (email_log rows + HTML files) → reclaim link → S dispute handler (AC-18).
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as reclaimGET } from "@/app/api/reclaim/route";
import { checkBans } from "./bans";
import { advance } from "./clock";
import { customers, emailLog, payments, reigns, reservations } from "./db/schema";
import { handleDisputeCreated } from "./disputes";
import { verifyReclaimToken } from "./email/links";
import { OutboxEmailProvider, setEmailProvider, type OutboxMeta } from "./email/provider";
import { setPolicyClassifier } from "./moderation";
import { flushNotifications } from "./notifications";
import { handleAuthorized } from "./throne/crown";
import { confirmReservation, createReservation } from "./throne/reservations";
import { getThroneState } from "./throne/state";
import { confirmBody, setupKit, someone, teardownKit, type Kit } from "./throne/testkit";

let kit: Kit;
let outboxDir: string;

beforeEach(async () => {
  kit = await setupKit();
  outboxDir = await mkdtemp(path.join(os.tmpdir(), "throne-outbox-"));
  setEmailProvider(new OutboxEmailProvider(outboxDir));
  setPolicyClassifier({ model: "fake-allow", classify: async () => ({ decision: "allow" }) });
});
afterEach(async () => {
  await flushNotifications();
  setEmailProvider(null);
  setPolicyClassifier(null);
  teardownKit();
  await rm(outboxDir, { recursive: true, force: true });
});

async function takeOver(name: string, email: string, amountCents?: number) {
  const who = someone();
  const res = await createReservation("eternal", who);
  await confirmReservation(res.reservationId, res.reservationToken, confirmBody(amountCents ?? res.minCents, name, { email, alertOptIn: true }), who);
  const intent = kit.pay.forReservation(res.reservationId)!;
  kit.pay.authorize(intent.id);
  const outcome = await handleAuthorized(intent.id);
  if (outcome.outcome !== "crowned") throw new Error(`takeover failed: ${JSON.stringify(outcome)}`);
  return { reservationId: res.reservationId, reignId: outcome.reignId, intent };
}

async function outbox(): Promise<OutboxMeta[]> {
  const files = (await readdir(outboxDir)).filter((f) => f.endsWith(".json"));
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(outboxDir, f), "utf8")) as OutboxMeta));
}

describe("takeover → emails → reclaim → dispute (real modules)", () => {
  it("crown fills every link G and S rely on; receipt + overthrow are sent; reclaim verifies; dispute satisfies AC-18", async () => {
    const alice = await takeOver("Alice", "alice@example.com", 1_000);
    advance(60_000);
    const bob = await takeOver("Bob", "bob@example.com");
    await flushNotifications();

    // --- crown transaction wrote everything downstream needs ---------------------------------
    const [bobReign] = await kit.db.select().from(reigns).where(eq(reigns.id, bob.reignId));
    const [bobPayment] = await kit.db.select().from(payments).where(eq(payments.reservationId, bob.reservationId));
    const [bobRes] = await kit.db.select().from(reservations).where(eq(reservations.id, bob.reservationId));
    const [bobCustomer] = await kit.db.select().from(customers).where(eq(customers.email, "bob@example.com"));
    expect(bobReign.customerId).toBe(bobCustomer.id);
    expect(bobReign.paymentId).toBe(bobPayment.id);
    expect(bobPayment).toMatchObject({ cardFingerprint: "fake_fp_4242", cardCountry: "DE", amountCents: 1_100, status: "succeeded" });
    expect(bobRes).toMatchObject({ state: "completed", reignId: bob.reignId, alertOptIn: true });
    expect(bobCustomer.alertOptIn).toBe(true);
    expect(bobCustomer.alertOptInAt).toBeInstanceOf(Date);

    // --- G: two receipts and one overthrow email, logged and in the outbox -------------------
    const log = await kit.db.select().from(emailLog);
    const summary = log.map((l) => `${l.type}:${l.reignId}:${l.status}`).sort();
    expect(summary).toEqual(
      [`receipt:${alice.reignId}:sent`, `receipt:${bob.reignId}:sent`, `overthrow:${alice.reignId}:sent`].sort(),
    );
    const mails = await outbox();
    expect(mails.map((m) => `${m.type}:${m.to}`).sort()).toEqual(
      ["overthrow:alice@example.com", "receipt:alice@example.com", "receipt:bob@example.com"].sort(),
    );
    const overthrow = mails.find((m) => m.type === "overthrow")!;
    expect(overthrow.subject).toBe("You’ve been overthrown");
    expect(overthrow.text).toContain("Bob");

    // --- the reclaim link verifies and opens checkout with the old name ----------------------
    const link = /https?:\/\/\S+\/api\/reclaim\?token=([^\s"&]+)/.exec(overthrow.text);
    expect(link).not.toBeNull();
    const token = decodeURIComponent(link![1]);
    expect(verifyReclaimToken(token)).toMatchObject({ r: alice.reignId, t: "eternal" });
    const redirect = await reclaimGET(new Request(`http://localhost:3000/api/reclaim?token=${encodeURIComponent(token)}`));
    expect(redirect.status).toBe(302);
    const location = new URL(redirect.headers.get("location")!, "http://localhost:3000");
    expect(location.pathname).toBe("/");
    expect(Object.fromEntries(location.searchParams)).toMatchObject({ checkout: "1", name: "Alice" });

    // --- S: a dispute on the current reign (AC-18) ------------------------------------------
    const priceBefore = (await getThroneState("eternal")).minCents;
    const dispute = (id: string, p: typeof bobPayment) =>
      ({
        id,
        object: "event",
        type: "charge.dispute.created",
        data: {
          object: {
            id: `dp_${id}`,
            object: "dispute",
            charge: p.stripeChargeId,
            payment_intent: p.stripePaymentIntentId,
            reason: "fraudulent",
          },
        },
      }) as unknown as Stripe.Event;
    await handleDisputeCreated(dispute("evt_dispute_bob", bobPayment));

    const after = await getThroneState("eternal");
    expect(after.king).toBeNull(); // king removed
    expect(after.vacancy?.reason).toBe("removed");
    expect(after.minCents).toBe(priceBefore); // price unchanged
    const [disputedReign] = await kit.db.select().from(reigns).where(eq(reigns.id, bob.reignId));
    expect(disputedReign).toMatchObject({ endReason: "disputed", disputed: true });
    const [disputedPayment] = await kit.db.select().from(payments).where(eq(payments.id, bobPayment.id));
    expect(disputedPayment).toMatchObject({ disputed: true, status: "disputed" });
    expect(await checkBans({ cardFingerprint: "fake_fp_4242" })).toMatchObject({ banned: true });
    expect(await checkBans({ email: "bob@example.com" })).toMatchObject({ banned: true });

    // S3: a dispute on an already-ended reign flags it but keeps its end reason.
    const [alicePayment] = await kit.db.select().from(payments).where(eq(payments.reservationId, alice.reservationId));
    await handleDisputeCreated(dispute("evt_dispute_alice", alicePayment));
    const [aliceReign] = await kit.db.select().from(reigns).where(eq(reigns.id, alice.reignId));
    expect(aliceReign).toMatchObject({ endReason: "takeover", disputed: true });

    // The banned card can no longer take the throne: cancelled before capture.
    const who = someone();
    const res = await createReservation("eternal", who);
    await confirmReservation(res.reservationId, res.reservationToken, confirmBody(res.minCents, "Carol", { email: "carol@example.com" }), who);
    const carolIntent = kit.pay.forReservation(res.reservationId)!;
    kit.pay.authorize(carolIntent.id);
    expect(await handleAuthorized(carolIntent.id)).toMatchObject({ outcome: "rejected", failReason: "banned" });
    expect(carolIntent.status).toBe("canceled");
  });
});
