// C acceptance tests at the service level: AC-01 … AC-13 (AC-19 and webhook routes in routes.test.ts).
// In-memory PGlite, fake clock, fake payments; moderation, bans and notifications are mocked.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advance, now, setNow } from "../clock";
import { payments, reigns, reservations } from "../db/schema";
import { removeCurrentKing } from "./admin-ops";
import { handleAuthorized, handlePaymentFailed } from "./crown";
import { dailyReset, expireReservations, reconcilePayments, retention } from "./jobs";
import {
  cancelReservation,
  confirmReservation,
  createReservation,
  getReservationStatus,
  heartbeat,
} from "./reservations";
import { getThroneState, listReigns } from "./state";
import { buy, confirmBody, count, setupKit, someone, teardownKit, type Kit } from "./testkit";

const mocks = vi.hoisted(() => ({
  moderation: null as null | { ok: false; status: 422 | 503; field: "name" | "proclamation" | null; category: string; message: string },
  moderationThrows: false,
  banned: false,
  onTakeoverCommitted: vi.fn(async () => {}),
}));

vi.mock("../moderation", () => ({
  moderateSubmission: async (input: { name: string; proclamation: string }) => {
    if (mocks.moderationThrows) throw new Error("LLM down");
    if (mocks.moderation) return mocks.moderation;
    return { ok: true, name: input.name.trim(), proclamation: input.proclamation.trim() };
  },
}));
vi.mock("../bans", () => ({ checkBans: async () => ({ banned: mocks.banned }) }));
vi.mock("../notifications", () => ({
  onTakeoverCommitted: mocks.onTakeoverCommitted,
  onKingRemoved: async () => {},
  onRefundIssued: async () => {},
}));

let kit: Kit;

beforeEach(async () => {
  kit = await setupKit();
  mocks.moderation = null;
  mocks.moderationThrows = false;
  mocks.banned = false;
  mocks.onTakeoverCommitted.mockClear();
});
afterEach(() => teardownKit());

const MIN = 60_000;
const HOUR = 60 * MIN;

describe("pricing through real takeovers", () => {
  it("AC-01: 30 buyers paying the minimum: €2.00, €2.20, €2.42 … €31.72; total €328.92; next €34.89", async () => {
    const paid: number[] = [];
    for (let i = 1; i <= 30; i++) {
      const { amount, outcome } = await buy(kit, "eternal", `King ${i}`);
      expect(outcome.outcome).toBe("crowned");
      paid.push(amount);
      advance(MIN);
    }
    expect(paid.slice(0, 4)).toEqual([200, 220, 242, 266]);
    expect(paid[29]).toBe(3172);
    expect(paid.reduce((a, b) => a + b, 0)).toBe(32_892);

    const s = await getThroneState("eternal");
    expect(s.minCents).toBe(3489);
    expect(s.king?.name).toBe("King 30");
    expect(s.version).toBe(30);
    expect(s.stats).toMatchObject({ reignCount: 30, totalPaidCents: 32_892 });
    expect(s.recent).toHaveLength(12);
    expect(s.recent[0].name).toBe("King 30");
    // Every previous reign ended by takeover; exactly one ongoing.
    const all = await kit.db.select().from(reigns);
    expect(all.filter((r) => r.endedAt === null)).toHaveLength(1);
    expect(all.filter((r) => r.endReason === "takeover")).toHaveLength(29);
    expect(await count(kit.db, payments)).toBe(30);
  });

  it("AC-02: last paid €100.00 → €110.00, €107.80, €105.64, €103.53 after 0, 24, 49, 72 h", async () => {
    await buy(kit, "eternal", "Centurion", 10_000);
    const mins: number[] = [];
    for (const h of [0, 24, 49, 72]) {
      setNow(new Date(Date.parse("2026-03-01T12:00:00Z") + h * HOUR));
      mins.push((await getThroneState("eternal")).minCents);
    }
    expect(mins).toEqual([11_000, 10_780, 10_564, 10_353]);
    // The reservation locks the same server-computed value.
    expect((await createReservation("eternal", someone())).minCents).toBe(10_353);
    expect((await getThroneState("eternal")).idleDays).toBe(3);
  });

  it("AC-03: last paid €2.00 and 10 days idle → minimum is the €2.00 floor", async () => {
    await buy(kit, "eternal", "Pauper", 200);
    advance(10 * 24 * HOUR);
    expect((await createReservation("eternal", someone())).minCents).toBe(200);
  });

  it("AC-05: minimum €2.42, buyer pays €150.00 → Duke, next minimum €165.00, hall shows Duke", async () => {
    await buy(kit, "eternal", "First");
    advance(MIN);
    await buy(kit, "eternal", "Second");
    advance(MIN);
    expect((await getThroneState("eternal")).minCents).toBe(242);
    const { outcome } = await buy(kit, "eternal", "Max", 15_000);
    expect(outcome.outcome).toBe("crowned");
    const s = await getThroneState("eternal");
    expect(s.king).toMatchObject({ name: "Max", title: "Duke", paidCents: 15_000 });
    expect(s.minCents).toBe(16_500);
    expect(`${s.recent[0].title} ${s.recent[0].name}`).toBe("Duke Max");
    const [reign] = await kit.db.select().from(reigns).where(eq(reigns.name, "Max"));
    expect(reign.title).toBe("Duke"); // stored at creation
  });
});

describe("daily throne", () => {
  it("AC-04: crowned 23:59 UTC → after 00:00 vacant with yesterday's ruler, €2.00, today's stats zero", async () => {
    setNow("2026-03-01T23:59:00Z");
    await buy(kit, "daily", "Night Owl", 5_000);
    expect((await getThroneState("daily")).minCents).toBe(5_500);

    setNow("2026-03-02T00:00:00.300Z");
    const job = await dailyReset();
    expect(job.endedReignId).not.toBeNull();
    const s = await getThroneState("daily");
    expect(s.king).toBeNull();
    expect(s.vacancy).toEqual({ reason: "reset", yesterdayRuler: "Night Owl" });
    expect(s.minCents).toBe(200);
    expect(s.stats).toMatchObject({ reignCount: 0, totalPaidCents: 0, longest: null, highest: null });
    expect(s.resetsAt).toBe("2026-03-03T00:00:00.000Z");
    const [old] = await kit.db.select().from(reigns).where(eq(reigns.name, "Night Owl"));
    expect(old.endReason).toBe("reset");
    expect(old.endedAt?.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    // Running it again is a no-op; the eternal throne is untouched.
    expect((await dailyReset()).endedReignId).toBeNull();
    expect((await createReservation("daily", someone())).minCents).toBe(200);
  });

  it("a takeover before the reset job ran ends yesterday's reign with reason reset at midnight", async () => {
    setNow("2026-03-01T23:59:00Z");
    await buy(kit, "daily", "Late", 5_000);
    setNow("2026-03-02T00:00:05Z");
    const { amount, outcome } = await buy(kit, "daily", "Early");
    expect(amount).toBe(200);
    expect(outcome.outcome).toBe("crowned");
    const [late] = await kit.db.select().from(reigns).where(eq(reigns.name, "Late"));
    expect(late).toMatchObject({ endReason: "reset" });
    expect(late.endedAt?.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(mocks.onTakeoverCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ previousReignId: null }));
  });
});

describe("checkout validation", () => {
  it("AC-06: €2.41 or €1,000,000.01 → 422, PaymentIntent unchanged, nothing charged", async () => {
    await buy(kit, "eternal", "A");
    await buy(kit, "eternal", "B");
    const who = someone();
    const res = await createReservation("eternal", who);
    expect(res.minCents).toBe(242);
    const intent = kit.pay.forReservation(res.reservationId)!;
    for (const amount of [241, 100_000_001, 242.5, Number.NaN]) {
      await expect(
        confirmReservation(res.reservationId, res.reservationToken, confirmBody(amount, "Cheap"), who),
      ).rejects.toMatchObject({ status: 422, error: "amount", extra: { minCents: 242, maxCents: 100_000_000 } });
    }
    expect(intent.amountCents).toBe(242);
    expect(intent.status).toBe("requires_payment_method");
    expect((await getReservationStatus(res.reservationId)).state).toBe("active");
    // The cap itself is allowed.
    const ok = await confirmReservation(res.reservationId, res.reservationToken, confirmBody(100_000_000, "Rich"), who);
    expect(ok.state).toBe("paying");
    expect(intent.amountCents).toBe(100_000_000);
  });

  it("validation errors: terms, email, name length; bad token → 401", async () => {
    const who = someone();
    const res = await createReservation("eternal", who);
    const confirm = (b: ReturnType<typeof confirmBody>, token = res.reservationToken) =>
      confirmReservation(res.reservationId, token, b, who);
    await expect(confirm({ ...confirmBody(200, "X"), termsAccepted: false })).rejects.toMatchObject({ status: 422, extra: { field: "termsAccepted" } });
    await expect(confirm({ ...confirmBody(200, "X"), email: "nope" })).rejects.toMatchObject({ status: 422, extra: { field: "email" } });
    await expect(confirm(confirmBody(200, "   ", { email: "blank@example.com" }))).rejects.toMatchObject({ status: 422, extra: { field: "name" } });
    await expect(confirm(confirmBody(200, "x".repeat(25)))).rejects.toMatchObject({ status: 422, extra: { field: "name" } });
    await expect(confirm(confirmBody(200, "X"), "wrong-token")).rejects.toMatchObject({ status: 401 });
    expect((await getReservationStatus(res.reservationId)).state).toBe("active");
  });

  it("moderation 422 passes field + category; 503 (or a throw) leaves the reservation active", async () => {
    const who = someone();
    const res = await createReservation("eternal", who);
    const intent = kit.pay.forReservation(res.reservationId)!;
    mocks.moderation = { ok: false, status: 422, field: "name", category: "links", message: "Links aren’t allowed." };
    await expect(
      confirmReservation(res.reservationId, res.reservationToken, confirmBody(500, "spam.example"), who),
    ).rejects.toMatchObject({ status: 422, error: "moderation", message: "Links aren’t allowed.", extra: { field: "name", category: "links" } });

    mocks.moderation = { ok: false, status: 503, field: null, category: "unavailable", message: "x" };
    await expect(
      confirmReservation(res.reservationId, res.reservationToken, confirmBody(500, "Fine"), who),
    ).rejects.toMatchObject({ status: 503, error: "moderation_unavailable" });

    mocks.moderation = null;
    mocks.moderationThrows = true;
    await expect(
      confirmReservation(res.reservationId, res.reservationToken, confirmBody(500, "Fine"), who),
    ).rejects.toMatchObject({ status: 503 });

    expect((await getReservationStatus(res.reservationId)).state).toBe("active");
    expect(intent.amountCents).toBe(200);
  });

  it("bans: 403 at reservation; at confirm the reservation fails (banned) and the intent is cancelled", async () => {
    mocks.banned = true;
    await expect(createReservation("eternal", someone())).rejects.toMatchObject({ status: 403, error: "banned" });
    mocks.banned = false;
    const who = someone();
    const res = await createReservation("eternal", who);
    mocks.banned = true;
    await expect(
      confirmReservation(res.reservationId, res.reservationToken, confirmBody(200, "Bad"), who),
    ).rejects.toMatchObject({ status: 403 });
    expect(await getReservationStatus(res.reservationId)).toMatchObject({ state: "failed", failReason: "banned" });
    expect(kit.pay.forReservation(res.reservationId)!.status).toBe("canceled");
  });

  it("rate limit: 3 unpaid reservations per IP (and per device) in 10 minutes, then 429", async () => {
    const who = someone();
    for (let i = 0; i < 3; i++) {
      const r = await createReservation("eternal", who);
      await cancelReservation(r.reservationId, r.reservationToken);
    }
    await expect(createReservation("eternal", who)).rejects.toMatchObject({ status: 429, error: "rate_limited" });
    await expect(createReservation("daily", { ipHash: "other-ip", deviceId: who.deviceId })).rejects.toMatchObject({ status: 429 });
    await expect(createReservation("eternal", { ipHash: who.ipHash, deviceId: null })).rejects.toMatchObject({ status: 429 });
    expect((await createReservation("eternal", someone())).minCents).toBe(200);
    advance(10 * MIN + 1);
    await expect(createReservation("daily", who)).resolves.toMatchObject({ minCents: 200 });
  });

  it("confirm extends the lock to 10 minutes, never past 13 minutes of total life", async () => {
    const who = someone();
    const res = await createReservation("eternal", who);
    const created = now().getTime();
    expect(Date.parse(res.expiresAt) - created).toBe(3 * MIN);
    for (let i = 0; i < 6; i++) {
      advance(20_000);
      await heartbeat(res.reservationId, res.reservationToken);
    }
    const s1 = await confirmReservation(res.reservationId, res.reservationToken, confirmBody(300, "Slow"), who);
    expect(s1.state).toBe("paying");
    expect(Date.parse(s1.expiresAt) - created).toBe(12 * MIN);
    advance(3 * MIN); // card declined, buyer tries again with another amount
    const s2 = await confirmReservation(res.reservationId, res.reservationToken, confirmBody(400, "Slow"), who);
    expect(Date.parse(s2.expiresAt) - created).toBe(13 * MIN);
    // Paying ignores the heartbeat: still valid after 5 silent minutes.
    advance(5 * MIN);
    await expireReservations();
    expect((await getReservationStatus(res.reservationId)).state).toBe("paying");
    advance(3 * MIN);
    await expireReservations();
    expect((await getReservationStatus(res.reservationId)).state).toBe("expired");
    expect(kit.pay.forReservation(res.reservationId)!.status).toBe("canceled");
  });
});

describe("two buyers and concurrency", () => {
  it("AC-07: while A holds the reservation, B gets 409 with A's lock end time", async () => {
    const a = await createReservation("eternal", someone());
    const err = await createReservation("eternal", someone()).catch((e) => e);
    expect(err).toMatchObject({ status: 409, error: "busy", extra: { lockedUntil: a.expiresAt } });
    expect((await getThroneState("eternal")).reservation).toEqual({ lockedUntil: a.expiresAt });
    // The other throne is independent.
    await expect(createReservation("daily", someone())).resolves.toBeTruthy();
  });

  it("AC-08: 50 parallel reservation requests → exactly one succeeds", async () => {
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => createReservation("eternal", someone())));
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(49);
    expect(rejected.every((r) => (r.reason as { status?: number }).status === 409)).toBe(true);
    expect(await count(kit.db, reservations)).toBe(1);
    expect(kit.pay.intents.size).toBe(1);
  });

  it("AC-09: A authorizes, A's reservation expires, B takes the throne, A's webhook arrives → A cancelled, B stays king", async () => {
    const aWho = someone();
    const a = await createReservation("eternal", aWho);
    await confirmReservation(a.reservationId, a.reservationToken, confirmBody(200, "Alice"), aWho);
    const aIntent = kit.pay.forReservation(a.reservationId)!;
    kit.pay.authorize(aIntent.id); // authorized, but the webhook is delayed

    advance(11 * MIN); // A's 10-minute paying lock runs out
    const { outcome } = await buy(kit, "eternal", "Bob");
    expect(outcome.outcome).toBe("crowned");

    const late = await handleAuthorized(aIntent.id);
    expect(late.outcome).not.toBe("crowned");
    expect(aIntent.status).toBe("canceled");
    expect(aIntent.chargeId).toBeNull();
    expect((await getThroneState("eternal")).king?.name).toBe("Bob");
    expect(await count(kit.db, payments)).toBe(1);
    expect((await getReservationStatus(a.reservationId)).state).toBe("expired");
  });

  it("AC-09 variant: webhook for an authorized-but-expired reservation before anyone else acted → cancel (outbid)", async () => {
    await buy(kit, "eternal", "Keeper");
    const who = someone();
    const a = await createReservation("eternal", who);
    await confirmReservation(a.reservationId, a.reservationToken, confirmBody(220, "Tardy"), who);
    const intent = kit.pay.forReservation(a.reservationId)!;
    kit.pay.authorize(intent.id);
    advance(10 * MIN + 1);
    expect(await handleAuthorized(intent.id)).toMatchObject({ outcome: "rejected", state: "expired", failReason: "outbid" });
    expect(intent.status).toBe("canceled");
    expect((await getThroneState("eternal")).king?.name).toBe("Keeper");
  });

  it("AC-10: the authorization webhook arrives twice (also concurrently) → one capture, one reign, one receipt", async () => {
    const { intent } = await buy(kit, "eternal", "Once");
    expect(await handleAuthorized(intent.id)).toMatchObject({ outcome: "duplicate" });

    const who = someone();
    const r = await createReservation("eternal", who);
    await confirmReservation(r.reservationId, r.reservationToken, confirmBody(220, "Twice"), who);
    const i2 = kit.pay.forReservation(r.reservationId)!;
    kit.pay.authorize(i2.id);
    const both = await Promise.all([handleAuthorized(i2.id), handleAuthorized(i2.id)]);
    expect(both.map((o) => o.outcome).sort()).toEqual(["crowned", "duplicate"]);

    expect(await count(kit.db, reigns)).toBe(2);
    expect(await count(kit.db, payments)).toBe(2);
    await vi.waitFor(() => expect(mocks.onTakeoverCommitted).toHaveBeenCalledTimes(2));
    expect(i2.captureKeys).toEqual(new Set([r.reservationId]));
  });

  it("AC-11: webhook never delivered → reconcile after 2 minutes finishes the takeover from the provider state", async () => {
    const who = someone();
    const r = await createReservation("eternal", who);
    await confirmReservation(r.reservationId, r.reservationToken, confirmBody(1_000, "Patient"), who);
    kit.pay.authorize(kit.pay.forReservation(r.reservationId)!.id);

    advance(MIN);
    expect((await reconcilePayments()).checked).toBe(0); // not stuck yet
    advance(MIN + 1_000);
    const job = await reconcilePayments();
    expect(job).toMatchObject({ checked: 1, outcomes: { crowned: 1 } });
    expect(await getReservationStatus(r.reservationId)).toMatchObject({ state: "completed" });
    expect((await getThroneState("eternal")).king).toMatchObject({ name: "Patient", title: "Baron" });
  });

  it("reconcile ends a stuck reservation whose intent was cancelled, and leaves one still in 3-D Secure", async () => {
    const who = someone();
    const r = await createReservation("eternal", who);
    await confirmReservation(r.reservationId, r.reservationToken, confirmBody(200, "Waiting"), who);
    advance(3 * MIN);
    expect((await reconcilePayments()).outcomes).toEqual({ pending: 1 });
    await kit.pay.cancel(kit.pay.forReservation(r.reservationId)!.id);
    expect((await reconcilePayments()).outcomes).toEqual({ canceled: 1 });
    expect(await getReservationStatus(r.reservationId)).toMatchObject({ state: "failed", failReason: "canceled" });
  });
});

describe("releasing the lock", () => {
  it("AC-12: buyer closes checkout → released at once; the next buyer can reserve immediately", async () => {
    const a = await createReservation("eternal", someone());
    await cancelReservation(a.reservationId, a.reservationToken);
    expect(await getReservationStatus(a.reservationId)).toMatchObject({ state: "released", failReason: "released" });
    expect(kit.pay.forReservation(a.reservationId)!.status).toBe("canceled");
    expect((await getThroneState("eternal")).reservation).toBeNull();
    await expect(createReservation("eternal", someone())).resolves.toBeTruthy();
    // Idempotent; cancelling a paying reservation works too.
    await cancelReservation(a.reservationId, a.reservationToken);
    await expect(cancelReservation(a.reservationId, "bad")).rejects.toMatchObject({ status: 401 });
  });

  it("AC-13: no heartbeat for 35 s → released (by the job, or lazily by the next buyer)", async () => {
    const a = await createReservation("eternal", someone());
    advance(20_000);
    expect((await heartbeat(a.reservationId, a.reservationToken)).state).toBe("active");
    advance(34_000); // 34 s since the last heartbeat
    await expireReservations();
    expect((await getReservationStatus(a.reservationId)).state).toBe("active");
    advance(1_000);
    expect(await expireReservations()).toMatchObject({ ended: 1 });
    expect(await getReservationStatus(a.reservationId)).toMatchObject({ state: "released", failReason: "released" });
    await expect(heartbeat(a.reservationId, a.reservationToken)).rejects.toMatchObject({ status: 410 });

    const b = await createReservation("eternal", someone());
    advance(36_000);
    await expect(createReservation("eternal", someone())).resolves.toBeTruthy(); // B silent → C gets it
    expect((await getReservationStatus(b.reservationId)).state).toBe("released");
    expect(kit.pay.forReservation(b.reservationId)!.status).toBe("canceled");
  });

  it("an active reservation expires after 3 minutes even with heartbeats; confirm then answers 410", async () => {
    const who = someone();
    const a = await createReservation("eternal", who);
    for (let i = 0; i < 9; i++) {
      advance(20_000);
      await heartbeat(a.reservationId, a.reservationToken).catch(() => null);
    }
    await expect(
      confirmReservation(a.reservationId, a.reservationToken, confirmBody(200, "Late"), who),
    ).rejects.toMatchObject({ status: 410 });
    expect(await getReservationStatus(a.reservationId)).toMatchObject({ state: "expired", failReason: "expired" });
  });
});

describe("crown edge cases", () => {
  it("capture failure → reservation failed (capture_failed), intent cancelled, no reign", async () => {
    const who = someone();
    const r = await createReservation("eternal", who);
    await confirmReservation(r.reservationId, r.reservationToken, confirmBody(200, "Unlucky"), who);
    const intent = kit.pay.forReservation(r.reservationId)!;
    kit.pay.authorize(intent.id);
    vi.spyOn(kit.pay, "capture").mockRejectedValueOnce(new Error("processor down"));
    expect(await handleAuthorized(intent.id)).toMatchObject({ outcome: "rejected", failReason: "capture_failed" });
    expect(intent.status).toBe("canceled");
    expect(await count(kit.db, reigns)).toBe(0);
    expect((await getThroneState("eternal")).version).toBe(0);
  });

  it("authorized amount mismatch or authorization without confirm → cancelled, never captured", async () => {
    const who = someone();
    const r = await createReservation("eternal", who);
    const intent = kit.pay.forReservation(r.reservationId)!;
    kit.pay.authorize(intent.id); // client confirmed with Stripe directly, skipping our confirm
    expect(await handleAuthorized(intent.id)).toMatchObject({ outcome: "rejected", failReason: "canceled" });
    expect(intent.status).toBe("canceled");

    const r2 = await createReservation("eternal", who);
    await confirmReservation(r2.reservationId, r2.reservationToken, confirmBody(500, "Tamper"), who);
    const i2 = kit.pay.forReservation(r2.reservationId)!;
    i2.amountCents = 200; // provider-side amount differs from what we validated
    kit.pay.authorize(i2.id);
    expect(await handleAuthorized(i2.id)).toMatchObject({ outcome: "rejected", failReason: "canceled" });
    expect(i2.status).toBe("canceled");
    expect(await count(kit.db, payments)).toBe(0);
  });

  it("card declined keeps the reservation paying; a second card then crowns", async () => {
    const who = someone();
    const r = await createReservation("eternal", who);
    await confirmReservation(r.reservationId, r.reservationToken, confirmBody(200, "Retry"), who);
    const intent = kit.pay.forReservation(r.reservationId)!;
    kit.pay.decline(intent.id);
    await handlePaymentFailed(intent.id);
    expect(await getReservationStatus(r.reservationId)).toMatchObject({ state: "paying", failReason: "card_declined" });
    kit.pay.authorize(intent.id);
    expect((await handleAuthorized(intent.id)).outcome).toBe("crowned");
    expect(await getReservationStatus(r.reservationId)).toMatchObject({ state: "completed", failReason: null });
  });

  it("an admin removal while someone is paying does not invalidate their checkout; the price stays", async () => {
    await buy(kit, "eternal", "Spammer", 1_000);
    const who = someone();
    const r = await createReservation("eternal", who);
    expect(r.minCents).toBe(1_100);
    await confirmReservation(r.reservationId, r.reservationToken, confirmBody(1_100, "Honest"), who);
    await removeCurrentKing("eternal", { reason: "removed", reasonCategory: "spam", actor: "admin@test" });
    const removed = await getThroneState("eternal");
    expect(removed.vacancy?.reason).toBe("removed");
    expect(removed.minCents).toBe(1_100);
    const intent = kit.pay.forReservation(r.reservationId)!;
    kit.pay.authorize(intent.id);
    expect((await handleAuthorized(intent.id)).outcome).toBe("crowned");
    expect((await getThroneState("eternal")).king?.name).toBe("Honest");
  });

  it("stores the normalized name, customer and payment; previous reign id goes to notifications", async () => {
    const first = await buy(kit, "eternal", "Ann");
    const who = someone();
    const r = await createReservation("eternal", who);
    await confirmReservation(r.reservationId, r.reservationToken, confirmBody(220, "  Ben  ", { proclamation: " Hail " , email: "Ben@Example.com " }), who);
    kit.pay.authorize(kit.pay.forReservation(r.reservationId)!.id);
    const out = await handleAuthorized(kit.pay.forReservation(r.reservationId)!.id);
    expect(out.outcome).toBe("crowned");
    const s = await getThroneState("eternal");
    expect(s.king).toMatchObject({ name: "Ben", proclamation: "Hail" });
    const [payment] = await kit.db.select().from(payments).where(eq(payments.reservationId, r.reservationId));
    expect(payment).toMatchObject({ amountCents: 220, status: "succeeded", currency: "EUR" });
    const [res] = await kit.db.select().from(reservations).where(eq(reservations.id, r.reservationId));
    expect(res.email).toBe("ben@example.com");
    await vi.waitFor(() =>
      expect(mocks.onTakeoverCommitted).toHaveBeenLastCalledWith({
        throne: "eternal",
        reignId: s.king!.id,
        previousReignId: first.outcome.outcome === "crowned" ? first.outcome.reignId : null,
      }),
    );
  });
});

describe("history and retention", () => {
  it("paginates history 50 per page, newest first, hidden excluded", async () => {
    const base = Date.parse("2026-01-01T00:00:00Z");
    await kit.db.insert(reigns).values(
      Array.from({ length: 55 }, (_, i) => ({
        throneId: "eternal" as const,
        name: `R${i}`,
        paidCents: 200,
        title: "Lord" as const,
        crestSeed: 0,
        startedAt: new Date(base + i * MIN),
        endedAt: new Date(base + (i + 1) * MIN),
        hidden: i === 54,
      })),
    );
    const p1 = await listReigns("eternal", null);
    expect(p1.reigns).toHaveLength(50);
    expect(p1.reigns[0].name).toBe("R53");
    const p2 = await listReigns("eternal", p1.nextCursor);
    expect(p2.reigns.map((r) => r.name)).toEqual(["R3", "R2", "R1", "R0"]);
    expect(p2.nextCursor).toBeNull();
  });

  it("retention deletes old moderation checks and expired bans", async () => {
    const { moderationChecks, bans } = await import("../db/schema");
    const old = new Date(now().getTime() - 181 * 24 * HOUR);
    await kit.db.insert(moderationChecks).values([
      { field: "name", rawText: "a", normalizedText: "a", result: "allow", model: "none", createdAt: old },
      { field: "name", rawText: "b", normalizedText: "b", result: "allow", model: "none" },
    ]);
    await kit.db.insert(bans).values([
      { kind: "ip", valueHash: "x", createdBy: "t", expiresAt: new Date(now().getTime() - 1) },
      { kind: "ip", valueHash: "y", createdBy: "t", expiresAt: null },
    ]);
    expect(await retention()).toEqual({ ok: true, moderationChecks: 1, bans: 1 });
  });
});
