// OWNER: C. Shared plumbing for the throne write paths: the throne row lock, version bumps,
// reservation DTOs and the live events that follow a state change.
import { and, eq, inArray } from "drizzle-orm";
import type { ReservationState, ReservationStatus, ThroneId } from "@/lib/contracts";
import { publish } from "../bus";
import type { Tx } from "../db/client";
import { reservations, thrones } from "../db/schema";
import { getPaymentProvider } from "../payments/provider";
import { OPEN_STATES } from "./rules";

export type ThroneRow = typeof thrones.$inferSelect;
export type ReservationRow = typeof reservations.$inferSelect;

/** SELECT … FOR UPDATE on the throne row: the lock for every state change on a throne. */
export async function lockThrone(tx: Tx, throne: ThroneId): Promise<ThroneRow> {
  const [row] = await tx.select().from(thrones).where(eq(thrones.id, throne)).for("update");
  if (!row) throw new Error(`unknown throne ${throne}`);
  return row;
}

/**
 * Bump the throne version. Changes that do not invalidate an open checkout (admin removal, hide,
 * blur, daily reset) pass carryReservations so the open reservation's snapshot follows along and
 * its "throne version unchanged" check at capture still passes. Only a takeover invalidates it.
 */
export async function bumpVersion(
  tx: Tx,
  row: ThroneRow,
  now: Date,
  patch: Partial<Omit<ThroneRow, "id" | "version" | "updatedAt">> = {},
  opts: { carryReservations: boolean } = { carryReservations: true },
): Promise<number> {
  const version = row.version + 1;
  await tx.update(thrones).set({ ...patch, version, updatedAt: now }).where(eq(thrones.id, row.id));
  if (opts.carryReservations) {
    await tx
      .update(reservations)
      .set({ throneVersion: version })
      .where(and(eq(reservations.throneId, row.id), inArray(reservations.state, [...OPEN_STATES])));
  }
  return version;
}

export function toReservationStatus(r: ReservationRow): ReservationStatus {
  return {
    id: r.id,
    throne: r.throneId,
    state: r.state,
    failReason: r.failReason ?? null,
    expiresAt: r.expiresAt.toISOString(),
    minCents: r.minCents,
    amountCents: r.amountCents ?? null,
    reignId: r.reignId ?? null,
  };
}

/** Public lock state for every viewer of the throne (no buyer data). */
export function publishReservationUpdated(throne: ThroneId, state: ReservationState | null, lockedUntil: Date | null): void {
  publish(throne, {
    type: "reservation.updated",
    data: { state, lockedUntil: lockedUntil ? lockedUntil.toISOString() : null },
  });
}

/** Private result; the SSE route forwards it only to the connection that owns the reservation. */
export function publishReservationResult(r: ReservationRow): void {
  publish(r.throneId, {
    type: "reservation.result",
    data: { reservationId: r.id, state: r.state, failReason: r.failReason ?? null, reignId: r.reignId ?? null },
  });
}

/** Announce a reservation that just ended without a takeover. */
export function announceEnded(r: ReservationRow): void {
  publishReservationResult(r);
  publishReservationUpdated(r.throneId, r.state, null);
}

/**
 * Make sure a PaymentIntent can never be charged: cancel it, or refund it if it was somehow
 * captured without a takeover. Never throws (logged instead) — callers run it after commit.
 */
export async function voidIntent(intentId: string | null, context: Record<string, unknown> = {}): Promise<void> {
  if (!intentId) return;
  const provider = getPaymentProvider();
  try {
    const intent = await provider.retrieve(intentId);
    if (intent.status === "canceled") return;
    if (intent.status === "succeeded") {
      console.error("[throne] refunding a captured payment without a takeover", { intentId, ...context });
      await provider.refund(intentId);
      return;
    }
    await provider.cancel(intentId);
  } catch (err) {
    console.error("[throne] could not void payment intent", { intentId, ...context, err });
  }
}

/** Run post-commit side effects for reservations that ended without a takeover. */
export async function settleEnded(ended: ReservationRow[]): Promise<void> {
  for (const r of ended) {
    announceEnded(r);
    await voidIntent(r.paymentIntentId, { reservationId: r.id, state: r.state });
  }
}

/** End an open reservation inside a transaction. Returns the updated row, or null if it was no longer open. */
export async function endReservation(
  tx: Tx,
  id: string,
  state: Exclude<ReservationState, "active" | "paying" | "completed">,
  failReason: ReservationRow["failReason"],
  now: Date,
): Promise<ReservationRow | null> {
  const [row] = await tx
    .update(reservations)
    .set({ state, failReason, updatedAt: now })
    .where(and(eq(reservations.id, id), inArray(reservations.state, [...OPEN_STATES])))
    .returning();
  return row ?? null;
}

/** Postgres unique violation (pg or PGlite, possibly wrapped by Drizzle). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e?.cause?.code ?? e?.code) === "23505";
}
