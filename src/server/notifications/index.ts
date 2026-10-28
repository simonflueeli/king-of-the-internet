// OWNER: G. Receipt, overthrow, removal and refund emails (PRD "Notifications and sharing").
// Callers fire and forget: every exported function returns at once, never throws, and does the
// work in the background (Next's after() when called inside a request, a detached promise
// otherwise). Each send is bounded by the provider timeout, so delivery happens well within 60 s.
//
// email_log rows: one per decision. status "sending" → "sent" | "failed"; "dropped" when the
// 15-minute overthrow limit swallowed the email. Overthrow rows carry the overthrown reign's id
// (the recipient's reign), all other rows the reign the email is about.
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { after } from "next/server";
import type { ThroneId } from "@/lib/contracts";
import { nextMinCents } from "@/lib/pricing";
import { now } from "../clock";
import { getConfig, pricingConfig } from "../config";
import { getDb, type Database } from "../db/client";
import { customers, emailLog, reigns, reservations } from "../db/schema";
import { normalizeEmail } from "../hash";
import { reclaimUrl, unsubscribeUrl } from "../email/links";
import { getEmailProvider, type EmailMessage, type EmailType } from "../email/provider";
import { renderOverthrow, renderReceipt, renderRefund, renderRemoval } from "../email/templates";

const pending = new Set<Promise<void>>();

function inBackground(label: string, task: () => Promise<void>): void {
  const p: Promise<void> = Promise.resolve()
    .then(task)
    .catch((err) => console.error(`[notifications] ${label} failed`, err))
    .finally(() => pending.delete(p));
  pending.add(p);
  try {
    after(p); // keeps serverless functions alive until the email is out
  } catch {
    // Outside a request scope (tests, scripts, timers): the promise simply runs detached.
  }
}

/** Wait for every background send started so far (tests, scripts, graceful shutdown). */
export async function flushNotifications(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

/** C calls this after the crown transaction commits. */
export async function onTakeoverCommitted(e: {
  throne: ThroneId;
  reignId: string;
  previousReignId: string | null;
}): Promise<void> {
  inBackground(`takeover ${e.reignId}`, async () => {
    const db = await getDb();
    const reign = await loadReign(db, e.reignId);
    if (!reign) {
      console.warn("[notifications] takeover for unknown reign", e);
      return;
    }
    const results = await Promise.allSettled([
      e.previousReignId ? sendOverthrow(db, reign, e.previousReignId) : Promise.resolve(),
      sendReceipt(db, reign),
    ]);
    for (const r of results) if (r.status === "rejected") console.error("[notifications] takeover email failed", r.reason);
  });
}

/** S calls this after an admin removal when "notify king" is chosen. */
export async function onKingRemoved(e: { reignId: string; reasonCategory: string; notify: boolean }): Promise<void> {
  if (!e.notify) return;
  inBackground(`removal ${e.reignId}`, async () => {
    const db = await getDb();
    const reign = await loadReign(db, e.reignId);
    if (!reign?.customer) return;
    if (await alreadyLogged(db, "removal", reign.id)) return;
    const rendered = renderRemoval({ throne: reign.throneId, title: reign.title, name: reign.name, reasonCategory: e.reasonCategory });
    await deliver(db, {
      log: { type: "removal", customerId: reign.customer.id, throneId: reign.throneId, reignId: reign.id },
      msg: { type: "removal", to: reign.customer.email, ...rendered, idempotencyKey: `removal-${reign.id}` },
    });
  });
}

export async function onRefundIssued(e: { reignId: string; amountCents: number }): Promise<void> {
  inBackground(`refund ${e.reignId}`, async () => {
    const db = await getDb();
    const reign = await loadReign(db, e.reignId);
    if (!reign?.customer) return;
    const rendered = renderRefund({ throne: reign.throneId, title: reign.title, name: reign.name, amountCents: e.amountCents });
    await deliver(db, {
      log: { type: "refund", customerId: reign.customer.id, throneId: reign.throneId, reignId: reign.id },
      msg: { type: "refund", to: reign.customer.email, ...rendered },
    });
  });
}

// ---------------------------------------------------------------------------------------------

type ReignRow = typeof reigns.$inferSelect;
type CustomerRow = typeof customers.$inferSelect;
type ReignWithCustomer = ReignRow & { customer: CustomerRow | null };
type LogFields = { type: EmailType; customerId: string; throneId: ThroneId; reignId: string };

async function loadReign(db: Database, id: string): Promise<ReignWithCustomer | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({ reign: reigns, customer: customers })
    .from(reigns)
    .leftJoin(customers, eq(reigns.customerId, customers.id))
    .where(eq(reigns.id, id));
  return row ? { ...row.reign, customer: row.customer } : null;
}

/** A sent or in-flight email of this type about this reign (duplicate takeover/removal calls). */
async function alreadyLogged(db: Database, type: EmailType, reignId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: emailLog.id })
    .from(emailLog)
    .where(and(eq(emailLog.type, type), eq(emailLog.reignId, reignId), inArray(emailLog.status, ["sending", "sent", "dropped"])))
    .limit(1);
  return !!row;
}

/**
 * Overthrow alerts are on for this reign when its buyer ticked the box at checkout (falling back to
 * the customer's flag when no reservation is linked) and has not unsubscribed since. A later opt-in
 * (customers.alert_opt_in_at after unsubscribed_at) counts as fresh consent.
 */
async function alertsOn(db: Database, reign: ReignRow, customer: CustomerRow): Promise<boolean> {
  const [res] = await db
    .select({ alertOptIn: reservations.alertOptIn })
    .from(reservations)
    .where(eq(reservations.reignId, reign.id))
    .limit(1);
  const optedIn = res ? res.alertOptIn : customer.alertOptIn;
  if (!optedIn) return false;
  const unsub = customer.unsubscribedAt;
  if (!unsub) return true;
  return !!customer.alertOptInAt && customer.alertOptInAt > unsub;
}

async function sendReceipt(db: Database, reign: ReignWithCustomer): Promise<void> {
  if (!reign.customer) return;
  if (await alreadyLogged(db, "receipt", reign.id)) return;
  const rendered = renderReceipt({
    throne: reign.throneId,
    title: reign.title,
    name: reign.name,
    paidCents: reign.paidCents,
    at: reign.startedAt,
    reignId: reign.id,
  });
  await deliver(db, {
    log: { type: "receipt", customerId: reign.customer.id, throneId: reign.throneId, reignId: reign.id },
    msg: { type: "receipt", to: reign.customer.email, ...rendered, idempotencyKey: `receipt-${reign.id}` },
  });
}

async function sendOverthrow(db: Database, usurper: ReignWithCustomer, previousReignId: string): Promise<void> {
  const prev = await loadReign(db, previousReignId);
  // Only a reign that this takeover ended (not a reset or removal) gets an overthrow email.
  if (!prev?.customer || prev.throneId !== usurper.throneId || prev.endReason !== "takeover") return;
  const recipient = prev.customer;
  if (usurper.customer && (usurper.customer.id === recipient.id || normalizeEmail(usurper.customer.email) === normalizeEmail(recipient.email))) {
    return; // the king overthrew themself
  }
  if (!(await alertsOn(db, prev, recipient))) return;

  const cfg = await getConfig();
  const log: LogFields = { type: "overthrow", customerId: recipient.id, throneId: prev.throneId, reignId: prev.id };

  // Gate: at most one overthrow email per recipient per throne per window; later ones are dropped.
  // The advisory lock serializes concurrent takeovers for the same recipient + throne on Postgres.
  const logId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`overthrow:${recipient.id}:${prev.throneId}`}))`);
    const [dup] = await tx
      .select({ id: emailLog.id })
      .from(emailLog)
      .where(and(eq(emailLog.type, "overthrow"), eq(emailLog.reignId, prev.id)))
      .limit(1);
    if (dup) return null; // duplicate call for the same takeover
    const [recent] = await tx
      .select({ id: emailLog.id })
      .from(emailLog)
      .where(
        and(
          eq(emailLog.type, "overthrow"),
          eq(emailLog.customerId, recipient.id),
          eq(emailLog.throneId, prev.throneId),
          inArray(emailLog.status, ["sending", "sent"]),
          gt(emailLog.sentAt, new Date(now().getTime() - cfg.overthrowEmailWindowMs)),
        ),
      )
      .limit(1);
    const [row] = await tx
      .insert(emailLog)
      .values({ ...log, status: recent ? "dropped" : "sending", sentAt: now() })
      .returning({ id: emailLog.id });
    return recent ? null : row.id;
  });
  if (!logId) return;

  const unsub = unsubscribeUrl(recipient.id);
  const rendered = renderOverthrow({
    throne: usurper.throneId,
    newTitle: usurper.title,
    newName: usurper.name,
    newReignId: usurper.id,
    // What the next takeover costs right after this one; the reclaim link always shows the live price.
    priceCents: nextMinCents(usurper.paidCents, pricingConfig(cfg)),
    reclaimUrl: reclaimUrl({ r: prev.id, t: prev.throneId }, cfg.reclaimTokenTtlMs),
    unsubscribeUrl: unsub,
  });
  await deliver(db, {
    logId,
    log,
    msg: {
      type: "overthrow",
      to: recipient.email,
      ...rendered,
      headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      idempotencyKey: `overthrow-${prev.id}`,
    },
  });
}

const ATTEMPTS = 2;

/** Send with one retry and record the outcome in email_log (inserting the row unless `logId` is given). */
async function deliver(db: Database, o: { logId?: string; log: LogFields; msg: EmailMessage }): Promise<void> {
  let logId = o.logId;
  if (!logId) {
    const [row] = await db
      .insert(emailLog)
      .values({ ...o.log, status: "sending", sentAt: now() })
      .returning({ id: emailLog.id });
    logId = row!.id;
  }
  let lastErr: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const { id } = await getEmailProvider().send(o.msg);
      await db.update(emailLog).set({ status: "sent", providerMessageId: id, sentAt: now() }).where(eq(emailLog.id, logId));
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  await db.update(emailLog).set({ status: "failed" }).where(eq(emailLog.id, logId));
  console.error(`[notifications] ${o.msg.type} email to customer ${o.log.customerId} failed`, lastErr);
}
