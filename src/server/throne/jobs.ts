// OWNER: C. Scheduled jobs (PRD "Scheduled jobs"). Pure async functions run by the in-process
// timers below (src/instrumentation.ts) and by GET /api/cron/{job}. All are idempotent and safe
// to run concurrently with requests: every state change happens under the throne row lock.
import { and, eq, inArray, lt, lte, or } from "drizzle-orm";
import { nextUtcMidnight } from "@/lib/pricing";
import { now as clockNow } from "../clock";
import { getConfig } from "../config";
import { getDb } from "../db/client";
import { bans, moderationChecks, reigns, reservations } from "../db/schema";
import { broadcastThrone } from "./admin-ops";
import { bumpVersion, endReservation, lockThrone, settleEnded, type ReservationRow } from "./common";
import { reconcileReservation } from "./crown";
import { OPEN_STATES, deadReason } from "./rules";
import { utcDayStart } from "./state";

export const JOB_NAMES = ["expire", "reconcile", "daily-reset", "retention"] as const;
export type JobName = (typeof JOB_NAMES)[number];

export function isJobName(v: string): v is JobName {
  return (JOB_NAMES as readonly string[]).includes(v);
}

/** Every 10 s: expire overdue reservations, release silent ones, void their PaymentIntents. */
export async function expireReservations(): Promise<{ ok: true; ended: number }> {
  const cfg = await getConfig();
  const db = await getDb();
  const now = clockNow();
  const silentSince = new Date(now.getTime() - cfg.heartbeatTimeoutMs);
  const candidates = await db
    .select({ id: reservations.id, throneId: reservations.throneId })
    .from(reservations)
    .where(
      and(
        inArray(reservations.state, [...OPEN_STATES]),
        or(
          lte(reservations.expiresAt, now),
          and(eq(reservations.state, "active"), lte(reservations.lastHeartbeatAt, silentSince)),
        ),
      ),
    );

  const ended: ReservationRow[] = [];
  for (const c of candidates) {
    const done = await db.transaction(async (tx) => {
      await lockThrone(tx, c.throneId);
      const at = clockNow();
      const [r] = await tx.select().from(reservations).where(eq(reservations.id, c.id));
      const reason = r && deadReason(r, cfg, at);
      return reason ? endReservation(tx, r.id, reason, reason, at) : null;
    });
    if (done) ended.push(done);
  }
  await settleEnded(ended);
  return { ok: true, ended: ended.length };
}

/** Every minute: reservations stuck in paying for over 2 minutes are checked against the provider. */
export async function reconcilePayments(): Promise<{ ok: true; checked: number; outcomes: Record<string, number> }> {
  const cfg = await getConfig();
  const db = await getDb();
  const cutoff = new Date(clockNow().getTime() - cfg.reconcileAfterMs);
  const stuck = await db
    .select()
    .from(reservations)
    .where(and(eq(reservations.state, "paying"), lt(reservations.payingAt, cutoff)));
  const outcomes: Record<string, number> = {};
  for (const r of stuck) {
    let outcome: string;
    try {
      outcome = await reconcileReservation(r);
    } catch (err) {
      console.error("[jobs] reconcile failed", { reservationId: r.id, err });
      outcome = "error";
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  if (stuck.length) console.warn("[jobs] reconciled stuck reservations", { count: stuck.length, outcomes });
  return { ok: true, checked: stuck.length, outcomes };
}

/**
 * 00:00 UTC: end the Daily Throne reign that started before today with reason "reset" (ended at
 * midnight exactly) and broadcast. The price needs no change: pricing already ignores takeovers
 * from earlier UTC dates. An open checkout keeps its locked price (version carried).
 */
export async function dailyReset(): Promise<{ ok: true; endedReignId: string | null }> {
  const db = await getDb();
  const endedReignId = await db.transaction(async (tx) => {
    const row = await lockThrone(tx, "daily");
    const now = clockNow();
    const dayStart = utcDayStart(now);
    if (!row.currentReignId) return null;
    const [current] = await tx.select().from(reigns).where(eq(reigns.id, row.currentReignId));
    if (current && current.startedAt >= dayStart) return null;
    if (current) {
      await tx.update(reigns).set({ endedAt: dayStart, endReason: "reset" }).where(eq(reigns.id, current.id));
    }
    await bumpVersion(tx, row, now, { currentReignId: null });
    return row.currentReignId;
  });
  // Broadcast even without a reign to end: the daily minimum and stats change at midnight too.
  await broadcastThrone("daily");
  return { ok: true, endedReignId };
}

/** Daily: delete moderation records older than the retention period and expired bans. */
export async function retention(): Promise<{ ok: true; moderationChecks: number; bans: number }> {
  const cfg = await getConfig();
  const db = await getDb();
  const now = clockNow();
  const cutoff = new Date(now.getTime() - cfg.moderationRetentionDays * 86_400_000);
  const checks = await db
    .delete(moderationChecks)
    .where(lt(moderationChecks.createdAt, cutoff))
    .returning({ id: moderationChecks.id });
  const expired = await db.delete(bans).where(lt(bans.expiresAt, now)).returning({ id: bans.id });
  return { ok: true, moderationChecks: checks.length, bans: expired.length };
}

export async function runJob(job: JobName): Promise<Record<string, unknown>> {
  switch (job) {
    case "expire":
      return expireReservations();
    case "reconcile":
      return reconcilePayments();
    case "daily-reset":
      return dailyReset();
    case "retention":
      return retention();
  }
}

// ---------------------------------------------------------------------------------------------
// In-process timers (single instance). Real time on purpose; the jobs themselves use clock.now().
// ---------------------------------------------------------------------------------------------

const g = globalThis as unknown as { __ktiJobsStarted?: boolean };

const EXPIRE_EVERY_MS = 10_000;
const RECONCILE_EVERY_MS = 60_000;
const RETENTION_EVERY_MS = 86_400_000;

function guarded(job: JobName): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return; // never overlap the same job
    running = true;
    try {
      await runJob(job);
    } catch (err) {
      console.error(`[jobs] ${job} failed`, err);
    } finally {
      running = false;
    }
  };
}

/** Start the job timers once per process (dev hot reloads re-run instrumentation). */
export function startJobTimers(): void {
  if (g.__ktiJobsStarted) return;
  g.__ktiJobsStarted = true;

  const expire = guarded("expire");
  const reconcile = guarded("reconcile");
  const reset = guarded("daily-reset");
  const retain = guarded("retention");

  setInterval(expire, EXPIRE_EVERY_MS).unref();
  setInterval(reconcile, RECONCILE_EVERY_MS).unref();
  setInterval(retain, RETENTION_EVERY_MS).unref();

  // Daily reset at every 00:00 UTC (+ a small margin), and once at startup to catch a missed midnight.
  const scheduleReset = () => {
    const wait = nextUtcMidnight(new Date()).getTime() - Date.now() + 250;
    setTimeout(async () => {
      await reset();
      scheduleReset();
    }, wait).unref();
  };
  scheduleReset();
  setTimeout(() => void reset(), 5_000).unref();
  setTimeout(() => void retain(), 60_000).unref();
}
