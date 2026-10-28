// OWNER: S. Admin console operations (AD-01…AD-09). Every mutation writes audit_log (directly or
// through C's admin-ops, which audit with the admin's email as actor).
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import type { ThroneId, ThroneState } from "@/lib/contracts";
import { copy } from "@/lib/copy";
import { now as clockNow } from "../clock";
import { CONFIG_DEFAULTS, getConfig, updateConfig, type AppConfig } from "../config";
import { getDb } from "../db/client";
import { auditLog, payments, reigns, reservations, thrones } from "../db/schema";
import { applyRefund } from "../disputes";
import { HttpError } from "../http";
import { POLICY_CATEGORIES } from "../moderation/categories";
import { onKingRemoved } from "../notifications";
import { getPaymentProvider } from "../payments/provider";
import { removeCurrentKing, setReignHidden } from "../throne/admin-ops";
import { getThroneState, THRONE_IDS } from "../throne/state";
import type { AdminIdentity } from "./auth";

export const REMOVAL_CATEGORIES = [...POLICY_CATEGORIES, "legal", "terms", "payment_issue", "other"] as const;
export type RemovalCategory = (typeof REMOVAL_CATEGORIES)[number];

export function isRemovalCategory(v: unknown): v is RemovalCategory {
  return typeof v === "string" && (REMOVAL_CATEGORIES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------------------------
// AD-01 live view
// ---------------------------------------------------------------------------------------------

type PaymentRow = typeof payments.$inferSelect;
type ReignRow = typeof reigns.$inferSelect;
type ReservationRow = typeof reservations.$inferSelect;

export interface AdminReign extends ReignRow {
  current: boolean;
  payment: PaymentRow | null;
}

export interface AdminThroneView {
  state: ThroneState;
  openReservation: Pick<
    ReservationRow,
    "id" | "state" | "minCents" | "amountCents" | "expiresAt" | "lastHeartbeatAt" | "payingAt" | "source" | "createdAt" | "name"
  > | null;
  reigns: AdminReign[];
}

/** Payments for reigns: via reigns.payment_id, else reservations.reign_id → payments.reservation_id. */
async function paymentsForReigns(rows: ReignRow[]): Promise<Map<string, PaymentRow>> {
  const out = new Map<string, PaymentRow>();
  if (!rows.length) return out;
  const db = await getDb();
  const reignIds = rows.map((r) => r.id);
  const paymentIds = rows.map((r) => r.paymentId).filter((x): x is string => !!x);
  const res = await db
    .select({ id: reservations.id, reignId: reservations.reignId })
    .from(reservations)
    .where(inArray(reservations.reignId, reignIds));
  const resIds = res.map((r) => r.id);
  const conds = [
    paymentIds.length ? inArray(payments.id, paymentIds) : undefined,
    resIds.length ? inArray(payments.reservationId, resIds) : undefined,
  ].filter((c) => c !== undefined);
  if (!conds.length) return out;
  const pays = await db.select().from(payments).where(or(...conds));
  for (const r of rows) {
    const resId = res.find((x) => x.reignId === r.id)?.id;
    const p = pays.find((x) => x.id === r.paymentId) ?? pays.find((x) => x.reservationId === resId);
    if (p) out.set(r.id, p);
  }
  return out;
}

export async function getAdminThroneView(throne: ThroneId, recentCount = 15): Promise<AdminThroneView> {
  const db = await getDb();
  const [state, [throneRow], [open], recent] = await Promise.all([
    getThroneState(throne),
    db.select().from(thrones).where(eq(thrones.id, throne)),
    db
      .select()
      .from(reservations)
      .where(and(eq(reservations.throneId, throne), inArray(reservations.state, ["active", "paying"])))
      .limit(1),
    db.select().from(reigns).where(eq(reigns.throneId, throne)).orderBy(desc(reigns.startedAt)).limit(recentCount),
  ]);
  const pays = await paymentsForReigns(recent);
  return {
    state,
    openReservation: open
      ? {
          id: open.id,
          state: open.state,
          minCents: open.minCents,
          amountCents: open.amountCents,
          expiresAt: open.expiresAt,
          lastHeartbeatAt: open.lastHeartbeatAt,
          payingAt: open.payingAt,
          source: open.source,
          createdAt: open.createdAt,
          name: open.name,
        }
      : null,
    reigns: recent.map((r) => ({ ...r, current: throneRow?.currentReignId === r.id, payment: pays.get(r.id) ?? null })),
  };
}

export async function getAdminLiveView(): Promise<AdminThroneView[]> {
  return Promise.all(THRONE_IDS.map((t) => getAdminThroneView(t)));
}

// ---------------------------------------------------------------------------------------------
// AD-02 remove king, AD-03 hide reign
// ---------------------------------------------------------------------------------------------

export async function adminRemoveKing(
  throne: ThroneId,
  opts: { reignId?: string; reasonCategory: RemovalCategory; notify: boolean },
  admin: AdminIdentity,
): Promise<{ removedReignId: string | null }> {
  const result = await removeCurrentKing(throne, {
    reason: "removed",
    reasonCategory: opts.reasonCategory,
    actor: admin.email,
    reignId: opts.reignId,
  });
  if (result.removedReignId) {
    onKingRemoved({ reignId: result.removedReignId, reasonCategory: opts.reasonCategory, notify: opts.notify }).catch((err) =>
      console.error("[admin] onKingRemoved failed", err),
    );
  }
  return result;
}

export async function adminSetHidden(reignId: string, hidden: boolean, admin: AdminIdentity): Promise<boolean> {
  const db = await getDb();
  const [reign] = await db.select({ id: reigns.id }).from(reigns).where(eq(reigns.id, reignId));
  if (!reign) return false;
  await setReignHidden(reignId, hidden, admin.email);
  return true;
}

// ---------------------------------------------------------------------------------------------
// AD-04 refunds
// ---------------------------------------------------------------------------------------------

export async function adminRefund(
  paymentId: string,
  amountCents: number | null,
  admin: AdminIdentity,
): Promise<{ refundedCents: number; removedReignId: string | null }> {
  const db = await getDb();
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p) throw new HttpError(404, "not_found", "Payment not found.");
  const remaining = p.amountCents - p.refundedCents;
  const amount = amountCents ?? remaining;
  if (!Number.isInteger(amount) || amount < 1 || amount > remaining) {
    throw new HttpError(422, "amount", `Enter an amount between 1 and ${remaining} cents.`);
  }
  try {
    await getPaymentProvider().refund(p.stripeChargeId ?? p.stripePaymentIntentId, amount);
  } catch (err) {
    console.error("[admin] refund failed", { paymentId, err: String(err) });
    await db.insert(auditLog).values({
      actor: admin.email,
      action: "payment.refund_failed",
      target: paymentId,
      after: { amountCents: amount, error: String(err).slice(0, 300) },
    });
    throw new HttpError(502, "refund_failed", "The payment provider rejected the refund. Nothing was refunded.");
  }
  const { removedReignId } = await applyRefund(paymentId, p.refundedCents + amount, admin.email);
  return { refundedCents: p.refundedCents + amount, removedReignId };
}

export async function listPayments(limit = 50) {
  const db = await getDb();
  const rows = await db
    .select({ payment: payments, throne: reservations.throneId, name: reservations.name, reignId: reservations.reignId })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .orderBy(desc(payments.createdAt))
    .limit(limit);
  return rows;
}

// ---------------------------------------------------------------------------------------------
// AD-07 config
// ---------------------------------------------------------------------------------------------

/** Editable config keys (everything numeric; currency is fixed). */
export const EDITABLE_CONFIG_KEYS = (Object.keys(CONFIG_DEFAULTS) as (keyof AppConfig)[]).filter(
  (k) => typeof CONFIG_DEFAULTS[k] === "number",
);

export async function adminUpdateConfig(patch: Record<string, unknown>, admin: AdminIdentity): Promise<AppConfig> {
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (!(EDITABLE_CONFIG_KEYS as string[]).includes(k)) throw new HttpError(422, "validation", `Unknown setting ${k}.`);
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < (k === "decayBps" ? 0 : 1)) {
      throw new HttpError(422, "validation", `${k} must be a whole number${k === "decayBps" ? "" : " above 0"}.`);
    }
    clean[k] = v;
  }
  const before = await getConfig();
  if (clean.baseCents !== undefined && clean.baseCents > (clean.maxCents ?? before.maxCents)) {
    throw new HttpError(422, "validation", "The base price cannot be above the maximum.");
  }
  const changed = Object.fromEntries(
    Object.entries(clean).filter(([k, v]) => (before as unknown as Record<string, unknown>)[k] !== v),
  );
  if (!Object.keys(changed).length) return before;
  const after = await updateConfig(changed as Partial<AppConfig>, admin.email);
  const db = await getDb();
  await db.insert(auditLog).values({
    actor: admin.email,
    action: "config.update",
    target: Object.keys(changed).join(","),
    before: Object.fromEntries(Object.keys(changed).map((k) => [k, (before as unknown as Record<string, unknown>)[k]])),
    after: changed,
  });
  return after;
}

// ---------------------------------------------------------------------------------------------
// AD-09 revenue
// ---------------------------------------------------------------------------------------------

export interface RevenueRow {
  day: string; // YYYY-MM-DD (UTC)
  throne: ThroneId;
  takeovers: number;
  grossCents: number;
  feeCents: number;
  refundedCents: number;
  disputes: number;
}

export async function revenueByDay(days = 30): Promise<RevenueRow[]> {
  const db = await getDb();
  const since = new Date(clockNow().getTime() - days * 86_400_000);
  const day = sql<string>`to_char(${payments.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      day,
      throne: reservations.throneId,
      takeovers: sql<number>`count(*)::int`,
      grossCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::bigint`,
      feeCents: sql<number>`coalesce(sum(${payments.feeCents}), 0)::bigint`,
      refundedCents: sql<number>`coalesce(sum(${payments.refundedCents}), 0)::bigint`,
      disputes: sql<number>`count(*) filter (where ${payments.disputed})::int`,
    })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(gte(payments.createdAt, since))
    .groupBy(day, reservations.throneId)
    .orderBy(desc(day), reservations.throneId);
  return rows.map((r) => ({
    ...r,
    takeovers: Number(r.takeovers),
    grossCents: Number(r.grossCents),
    feeCents: Number(r.feeCents),
    refundedCents: Number(r.refundedCents),
    disputes: Number(r.disputes),
  }));
}

// ---------------------------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------------------------

export async function listAudit(limit = 100) {
  const db = await getDb();
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
}

export const removalLabel = (c: string): string =>
  (copy.safety.admin.removalCategories as Record<string, string>)[c] ?? c;
