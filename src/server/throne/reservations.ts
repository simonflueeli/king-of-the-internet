// OWNER: C. Reservations: the short exclusive price lock while one buyer is in checkout
// (PRD "Checkout and payment" → Flow). Services throw HttpError; route handlers stay thin.
//
// Lifecycle: active (3 min, heartbeat every 20 s, released after 35 s of silence)
//   → confirm → paying (10 min from confirm, never past 13 min total life)
//   → completed (crown.ts) | expired | released | failed.
// Every path except completed ends with the PaymentIntent voided (cancelled), after commit.
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { fill, copy } from "@/lib/copy";
import type {
  ConfirmReservationRequest,
  CreateReservationResponse,
  ReservationStatus,
  ThroneId,
} from "@/lib/contracts";
import { formatMoney } from "@/lib/format";
import { textLength } from "@/lib/normalize";
import { isValidAmount, minPriceCents } from "@/lib/pricing";
import { checkBans } from "../bans";
import { now as clockNow } from "../clock";
import { getConfig, pricingConfig, type AppConfig } from "../config";
import { getDb, type Tx } from "../db/client";
import { customers, reservations, type ReservationSource } from "../db/schema";
import { hashToken, normalizeEmail, randomToken, safeEqual } from "../hash";
import { HttpError } from "../http";
import { moderateSubmission } from "../moderation";
import { getPaymentProvider } from "../payments/provider";
import {
  endReservation,
  isUniqueViolation,
  lockThrone,
  publishReservationUpdated,
  settleEnded,
  toReservationStatus,
  type ReservationRow,
} from "./common";
import { isRateLimited } from "./ratelimit";
import { OPEN_STATES, deadReason, isOpenState, payingExpiry } from "./rules";
import { isUuid } from "./state";

/** Who is asking: salted IP hash and the raw `kti_device` cookie value (both used for abuse limits/bans). */
export interface Requester {
  ipHash: string | null;
  deviceId: string | null;
}

export const RESERVATION_SOURCES: readonly ReservationSource[] = ["button", "tryon", "reclaim"];
const MAX_RAW_TEXT = 1_000; // anything longer is rejected before normalization / moderation
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function busy(lockedUntil: Date): HttpError {
  return new HttpError(409, "busy", copy.errBusy, { lockedUntil: lockedUntil.toISOString() });
}

const expiredError = () => new HttpError(410, "expired", copy.errExpired);

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------

export async function createReservation(
  throne: ThroneId,
  who: Requester,
  source: ReservationSource = "button",
): Promise<CreateReservationResponse> {
  const cfg = await getConfig();
  const provider = getPaymentProvider();

  const ban = await checkBans({ ipHash: who.ipHash ?? undefined, deviceId: who.deviceId ?? undefined });
  if (ban.banned) throw new HttpError(403, "banned", copy.core.errBanned);

  const id = randomUUID();
  const token = randomToken(32);
  const db = await getDb();
  const ended: ReservationRow[] = [];

  let created: ReservationRow;
  try {
    created = await db.transaction(async (tx) => {
      const now = clockNow();
      const row = await lockThrone(tx, throne);

      if (await isRateLimited(tx, who, cfg, now)) {
        throw new HttpError(429, "rate_limited", copy.errRateLimited);
      }

      const [open] = await tx
        .select()
        .from(reservations)
        .where(and(eq(reservations.throneId, throne), inArray(reservations.state, [...OPEN_STATES])))
        .limit(1);
      if (open) {
        // A lock whose holder went silent or ran out of time is released right here, so the next
        // buyer never waits for the expire job.
        const reason = deadReason(open, cfg, now);
        if (!reason) throw busy(open.expiresAt);
        const done = await endReservation(tx, open.id, reason, reason, now);
        if (done) ended.push(done);
      }

      const pricing = pricingConfig(cfg);
      const last = row.lastPaidCents != null && row.crownedAt ? { paidCents: row.lastPaidCents, crownedAt: row.crownedAt } : null;
      const minCents = minPriceCents(throne, last, now, pricing);
      if (minCents > pricing.maxCents) throw new HttpError(409, "price_cap", copy.core.errPriceCap);

      const [inserted] = await tx
        .insert(reservations)
        .values({
          id,
          throneId: throne,
          minCents,
          throneVersion: row.version,
          state: "active",
          expiresAt: new Date(now.getTime() + cfg.reservationMs),
          lastHeartbeatAt: now,
          clientIpHash: who.ipHash,
          deviceId: who.deviceId,
          reservationTokenHash: hashToken(token),
          source,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return inserted;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Only reachable if the row lock were bypassed; the partial unique index still says no.
      throw busy(new Date(clockNow().getTime() + cfg.reservationMs));
    }
    throw err;
  }

  await settleEnded(ended);

  let intent: { id: string; clientSecret: string };
  try {
    intent = await provider.createIntent({ amountCents: created.minCents, reservationId: id, throne });
  } catch (err) {
    console.error("[reservations] createIntent failed", { reservationId: id, err });
    const failed = await db.transaction(async (tx) => {
      await lockThrone(tx, throne);
      return endReservation(tx, id, "failed", "canceled", clockNow());
    });
    if (failed) await settleEnded([failed]);
    throw new HttpError(502, "payment_unavailable", copy.core.errPaymentUnavailable);
  }

  await db.update(reservations).set({ paymentIntentId: intent.id }).where(eq(reservations.id, id));
  publishReservationUpdated(throne, "active", created.expiresAt);

  return {
    reservationId: id,
    reservationToken: token,
    clientSecret: intent.clientSecret,
    minCents: created.minCents,
    expiresAt: created.expiresAt.toISOString(),
    paymentMode: provider.mode,
  };
}

// ---------------------------------------------------------------------------------------------
// Lookup / auth
// ---------------------------------------------------------------------------------------------

async function findReservation(id: string): Promise<ReservationRow> {
  if (!isUuid(id)) throw new HttpError(404, "not_found", copy.core.errNotFound);
  const db = await getDb();
  const [r] = await db.select().from(reservations).where(eq(reservations.id, id));
  if (!r) throw new HttpError(404, "not_found", copy.core.errNotFound);
  return r;
}

/** Load a reservation and prove the caller created it (X-Reservation-Token). */
export async function authorizeReservation(id: string, token: string | null | undefined): Promise<ReservationRow> {
  const r = await findReservation(id);
  if (!token || !safeEqual(hashToken(token), r.reservationTokenHash)) {
    throw new HttpError(401, "bad_token", copy.core.errBadToken);
  }
  return r;
}

/** Non-throwing variant for the SSE route. */
export async function verifyReservationToken(id: string, token: string): Promise<ReservationRow | null> {
  try {
    return await authorizeReservation(id, token);
  } catch {
    return null;
  }
}

export async function getReservationStatus(id: string): Promise<ReservationStatus> {
  return toReservationStatus(await findReservation(id));
}

/**
 * Lock the throne, re-read the reservation and end it if its time is up. Returns the fresh row
 * (still open), or throws 410 after ending it. `fn` runs inside the same transaction.
 */
async function withLiveReservation<T>(
  r: ReservationRow,
  cfg: AppConfig,
  fn: (tx: Tx, fresh: ReservationRow, now: Date) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  const result = await db.transaction(async (tx): Promise<{ ended: ReservationRow | null } | { value: T }> => {
    await lockThrone(tx, r.throneId);
    const now = clockNow();
    const [fresh] = await tx.select().from(reservations).where(eq(reservations.id, r.id));
    if (fresh.state === "completed") throw new HttpError(409, "completed", copy.core.errCompleted);
    if (!isOpenState(fresh.state)) throw expiredError();
    const reason = deadReason(fresh, cfg, now);
    // Commit the end of a reservation whose time is up, then answer 410 below.
    if (reason) return { ended: await endReservation(tx, fresh.id, reason, reason, now) };
    return { value: await fn(tx, fresh, now) };
  });
  if ("value" in result) return result.value;
  if (result.ended) await settleEnded([result.ended]);
  throw expiredError();
}

// ---------------------------------------------------------------------------------------------
// Heartbeat / cancel
// ---------------------------------------------------------------------------------------------

export async function heartbeat(id: string, token: string | null): Promise<ReservationStatus> {
  const r = await authorizeReservation(id, token);
  if (r.state === "completed") return toReservationStatus(r);
  if (!isOpenState(r.state)) throw expiredError();
  const cfg = await getConfig();
  const fresh = await withLiveReservation(r, cfg, async (tx, cur, now) => {
    if (cur.state !== "active") return cur;
    const [updated] = await tx
      .update(reservations)
      .set({ lastHeartbeatAt: now, updatedAt: now })
      .where(eq(reservations.id, cur.id))
      .returning();
    return updated;
  });
  return toReservationStatus(fresh);
}

/**
 * DELETE: release immediately (active, or paying without an authorization). Idempotent for
 * already-ended reservations; 409 payment_in_progress once the card is authorized.
 */
export async function cancelReservation(id: string, token: string | null): Promise<void> {
  const r = await authorizeReservation(id, token);
  if (r.state === "completed") throw new HttpError(409, "completed", copy.core.errCompleted);
  if (!isOpenState(r.state)) return;
  // Paying with nothing authorized (e.g. after a decline) releases like an active lock. Once the
  // card is authorized the takeover is being completed; cancelling then would race the crown.
  if (r.state === "paying" && r.paymentIntentId) {
    const intent = await getPaymentProvider().retrieve(r.paymentIntentId);
    if (intent.status === "requires_capture" || intent.status === "succeeded" || intent.status === "processing") {
      throw new HttpError(409, "payment_in_progress", copy.core.errPaymentInProgress);
    }
  }
  const db = await getDb();
  const done = await db.transaction(async (tx) => {
    await lockThrone(tx, r.throneId);
    const [fresh] = await tx.select().from(reservations).where(eq(reservations.id, r.id));
    if (fresh.state === "completed") throw new HttpError(409, "completed", copy.core.errCompleted);
    return endReservation(tx, r.id, "released", "released", clockNow());
  });
  if (done) await settleEnded([done]);
}

// ---------------------------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------------------------

function validation(field: string, message: string): HttpError {
  return new HttpError(422, "validation", message, { field });
}

/** Shape-check the body; amounts are checked separately against the locked minimum. */
export function parseConfirmBody(body: unknown): ConfirmReservationRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "bad_request", copy.core.errBadRequest);
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : k === "proclamation" && b[k] == null ? "" : null);
  const name = str("name");
  const proclamation = str("proclamation");
  const email = str("email");
  if (name === null) throw validation("name", fill(copy.core.errName, { max: 24 }));
  if (proclamation === null) throw validation("proclamation", fill(copy.core.errProclamation, { max: 140 }));
  if (email === null) throw validation("email", copy.core.errEmail);
  return {
    amountCents: b.amountCents as number,
    name,
    proclamation,
    email,
    alertOptIn: b.alertOptIn === true,
    termsAccepted: b.termsAccepted === true,
  };
}

export async function confirmReservation(
  id: string,
  token: string | null,
  body: ConfirmReservationRequest,
  who: Requester,
): Promise<ReservationStatus> {
  const r = await authorizeReservation(id, token);
  const cfg = await getConfig();
  const pricing = pricingConfig(cfg);
  const provider = getPaymentProvider();

  if (r.state === "completed") throw new HttpError(409, "completed", copy.core.errCompleted);
  if (!isOpenState(r.state) || deadReason(r, cfg, clockNow())) {
    // Let the shared path end it properly (and answer 410).
    await withLiveReservation(r, cfg, async () => undefined);
    throw expiredError();
  }

  // 1. Amount: whole cents between the locked minimum and the cap. No provider call on failure.
  if (!isValidAmount(body.amountCents, r.minCents, pricing)) {
    throw new HttpError(
      422,
      "amount",
      fill(copy.errAmount, { min: formatMoney(r.minCents, { locale: "en-IE" }), max: formatMoney(pricing.maxCents, { locale: "en-IE", round: true }) }),
      { field: "amountCents", minCents: r.minCents, maxCents: pricing.maxCents },
    );
  }

  // 2. Plain validation.
  if (!body.termsAccepted) throw validation("termsAccepted", copy.core.errTerms);
  const email = normalizeEmail(body.email);
  if (email.length > 254 || !EMAIL_RE.test(email)) throw validation("email", copy.core.errEmail);
  if (body.name.length > MAX_RAW_TEXT) throw validation("name", fill(copy.core.errName, { max: cfg.nameMax }));
  if (body.proclamation.length > MAX_RAW_TEXT) {
    throw validation("proclamation", fill(copy.core.errProclamation, { max: cfg.proclamationMax }));
  }

  // 3. A payment that is already authorized cannot be changed any more.
  if (r.state === "paying" && r.paymentIntentId) {
    const intent = await provider.retrieve(r.paymentIntentId);
    if (intent.status === "requires_capture" || intent.status === "succeeded" || intent.status === "processing") {
      throw new HttpError(409, "payment_in_progress", copy.core.errPaymentInProgress);
    }
  }

  // 4. Bans (email, IP, device).
  const ban = await checkBans({ email, ipHash: who.ipHash ?? r.clientIpHash ?? undefined, deviceId: who.deviceId ?? r.deviceId ?? undefined });
  if (ban.banned) {
    const db = await getDb();
    const done = await db.transaction(async (tx) => {
      await lockThrone(tx, r.throneId);
      return endReservation(tx, r.id, "failed", "banned", clockNow());
    });
    if (done) await settleEnded([done]);
    throw new HttpError(403, "banned", copy.core.errBanned);
  }

  // 5. Moderation (S). Fails closed: an exception counts as unavailable. The reservation stays
  //    active either way so the buyer can edit and resubmit.
  let moderated: Awaited<ReturnType<typeof moderateSubmission>>;
  try {
    moderated = await moderateSubmission({ reservationId: r.id, name: body.name, proclamation: body.proclamation });
  } catch (err) {
    console.error("[reservations] moderation threw", { reservationId: r.id, err });
    moderated = { ok: false, status: 503, field: null, category: "unavailable", message: copy.errModerationUnavailable };
  }
  if (!moderated.ok) {
    if (moderated.status === 503) throw new HttpError(503, "moderation_unavailable", copy.errModerationUnavailable);
    throw new HttpError(422, "moderation", moderated.message, { field: moderated.field, category: moderated.category });
  }
  const name = moderated.name;
  const proclamation = moderated.proclamation;
  const nameLen = textLength(name);
  if (nameLen < 1 || nameLen > cfg.nameMax) throw validation("name", fill(copy.core.errName, { max: cfg.nameMax }));
  if (textLength(proclamation) > cfg.proclamationMax) {
    throw validation("proclamation", fill(copy.core.errProclamation, { max: cfg.proclamationMax }));
  }

  // 6. Put the chosen amount on the PaymentIntent before the state changes: if this fails the
  //    reservation stays active and nothing can be authorized for an unexpected amount.
  if (!r.paymentIntentId) throw new HttpError(502, "payment_unavailable", copy.core.errPaymentUnavailable);
  try {
    await provider.updateAmount(r.paymentIntentId, body.amountCents);
  } catch (err) {
    const latest = await findReservation(r.id);
    if (!isOpenState(latest.state)) throw expiredError();
    console.error("[reservations] updateAmount failed", { reservationId: r.id, err });
    throw new HttpError(502, "payment_unavailable", copy.core.errPaymentUnavailable);
  }

  // 7. Commit: customer upsert + reservation → paying, lock extended.
  const updated = await withLiveReservation(r, cfg, async (tx, cur, now) => {
    await tx
      .insert(customers)
      .values({ email, alertOptIn: body.alertOptIn, alertOptInAt: body.alertOptIn ? now : null, createdAt: now })
      .onConflictDoUpdate({
        target: customers.email,
        // The latest checkout choice wins. Opting in again is fresh consent and lifts an earlier unsubscribe.
        set: body.alertOptIn ? { alertOptIn: true, alertOptInAt: now, unsubscribedAt: null } : { alertOptIn: false },
      });
    const [row] = await tx
      .update(reservations)
      .set({
        amountCents: body.amountCents,
        name,
        proclamation: proclamation || null,
        email,
        alertOptIn: body.alertOptIn,
        termsAcceptedAt: now,
        state: "paying",
        failReason: null,
        payingAt: now,
        expiresAt: payingExpiry(cur.createdAt, now, cfg),
        updatedAt: now,
      })
      .where(eq(reservations.id, cur.id))
      .returning();
    return row;
  });

  publishReservationUpdated(updated.throneId, "paying", updated.expiresAt);
  return toReservationStatus(updated);
}
