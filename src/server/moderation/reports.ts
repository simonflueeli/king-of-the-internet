// OWNER: S. Viewer reports (PRD "Reports", FR-07) and the admin report queue (AD-06).
// 3 pending reports on one reign from different IPs within 10 minutes blur its proclamation until
// an admin approves (keep, unblur) or removes (end reign if current, hide everywhere).
import { and, count, countDistinct, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { normalizeText } from "@/lib/normalize";
import type { ReportReason } from "../db/schema";
import { now as clockNow } from "../clock";
import { getConfig } from "../config";
import { getDb } from "../db/client";
import { auditLog, reigns, reports, thrones } from "../db/schema";
import { onKingRemoved } from "../notifications";
import { removeCurrentKing, setReignBlurred, setReignHidden } from "../throne/admin-ops";

export const REPORT_REASONS: readonly ReportReason[] = ["offensive", "impersonation", "spam", "other"];
export const REPORT_DETAILS_MAX = 500;
/** Reports per IP per rate-limit window (config rateLimitWindowMs, 10 min by default). */
export const REPORTS_PER_IP = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === "string" && (REPORT_REASONS as readonly string[]).includes(v);
}

export type SubmitReportResult =
  | { ok: true; reportId: string; blurred: boolean }
  | { ok: false; error: "validation" | "not_found" | "rate_limited" };

export async function submitReport(input: {
  reignId: unknown;
  reason: unknown;
  details?: unknown;
  ipHash: string;
}): Promise<SubmitReportResult> {
  if (typeof input.reignId !== "string" || !UUID_RE.test(input.reignId) || !isReportReason(input.reason)) {
    return { ok: false, error: "validation" };
  }
  if (input.details != null && typeof input.details !== "string") return { ok: false, error: "validation" };
  const details = Array.from(normalizeText(input.details ?? "")).slice(0, REPORT_DETAILS_MAX).join("") || null;
  const reignId = input.reignId;

  const cfg = await getConfig();
  const at = clockNow();
  const db = await getDb();

  const [reign] = await db.select({ id: reigns.id, blurred: reigns.blurred }).from(reigns).where(eq(reigns.id, reignId));
  if (!reign) return { ok: false, error: "not_found" };

  const rateSince = new Date(at.getTime() - cfg.rateLimitWindowMs);
  const [{ n }] = await db
    .select({ n: count() })
    .from(reports)
    .where(and(eq(reports.reporterIpHash, input.ipHash), gte(reports.createdAt, rateSince)));
  if (n >= REPORTS_PER_IP) return { ok: false, error: "rate_limited" };

  // One pending report per IP and reign: repeats are accepted but not stored again.
  const [existing] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.reignId, reignId), eq(reports.reporterIpHash, input.ipHash), eq(reports.status, "pending")))
    .limit(1);
  const reportId =
    existing?.id ??
    (
      await db
        .insert(reports)
        .values({ reignId, reason: input.reason, details, reporterIpHash: input.ipHash, createdAt: at })
        .returning({ id: reports.id })
    )[0].id;

  const blurSince = new Date(at.getTime() - cfg.reportBlurWindowMs);
  const [{ ips }] = await db
    .select({ ips: countDistinct(reports.reporterIpHash) })
    .from(reports)
    .where(and(eq(reports.reignId, reignId), eq(reports.status, "pending"), gte(reports.createdAt, blurSince)));
  const blurred = reign.blurred || ips >= cfg.reportBlurThreshold;
  if (blurred && !reign.blurred) await setReignBlurred(reignId, true);
  return { ok: true, reportId, blurred };
}

// ---------------------------------------------------------------------------------------------
// Admin queue
// ---------------------------------------------------------------------------------------------

export interface ReportQueueItem {
  reignId: string;
  throne: string;
  name: string;
  proclamation: string | null;
  hidden: boolean;
  blurred: boolean;
  current: boolean;
  endReason: string | null;
  count: number;
  distinctIps: number;
  reasons: Record<string, number>;
  details: string[];
  firstAt: Date;
  lastAt: Date;
}

/** Pending reports grouped by reign, most reported first. */
export async function listReportQueue(limit = 100): Promise<ReportQueueItem[]> {
  const db = await getDb();
  const pending = await db
    .select()
    .from(reports)
    .where(eq(reports.status, "pending"))
    .orderBy(desc(reports.createdAt))
    .limit(2000);
  if (!pending.length) return [];
  const reignIds = [...new Set(pending.map((r) => r.reignId))];
  const [reignRows, throneRows] = await Promise.all([
    db.select().from(reigns).where(inArray(reigns.id, reignIds)),
    db.select({ current: thrones.currentReignId }).from(thrones),
  ]);
  const currentIds = new Set(throneRows.map((t) => t.current).filter(Boolean));
  const items = reignRows.map((reign): ReportQueueItem => {
    const rs = pending.filter((r) => r.reignId === reign.id);
    const reasons: Record<string, number> = {};
    for (const r of rs) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    return {
      reignId: reign.id,
      throne: reign.throneId,
      name: reign.name,
      proclamation: reign.proclamation,
      hidden: reign.hidden,
      blurred: reign.blurred,
      current: currentIds.has(reign.id),
      endReason: reign.endReason,
      count: rs.length,
      distinctIps: new Set(rs.map((r) => r.reporterIpHash)).size,
      reasons,
      details: rs.map((r) => r.details).filter((d): d is string => !!d).slice(0, 10),
      firstAt: rs[rs.length - 1].createdAt,
      lastAt: rs[0].createdAt,
    };
  });
  return items.sort((a, b) => b.distinctIps - a.distinctIps || b.lastAt.getTime() - a.lastAt.getTime()).slice(0, limit);
}

export async function pendingReportCount(): Promise<number> {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(distinct ${reports.reignId})::int` }).from(reports).where(eq(reports.status, "pending"));
  return Number(n);
}

/**
 * Admin decision on all pending reports of a reign.
 *   approve → the reign is fine: reports approved, proclamation unblurred.
 *   remove  → the reign goes: king removed if current, reign hidden, reports marked removed.
 */
export async function decideReports(
  reignId: string,
  action: "approve" | "remove",
  actor: string,
  opts: { reasonCategory?: string; notify?: boolean } = {},
): Promise<{ resolved: number; removedReignId: string | null }> {
  const db = await getDb();
  const [reign] = await db.select().from(reigns).where(eq(reigns.id, reignId));
  if (!reign) return { resolved: 0, removedReignId: null };

  let removedReignId: string | null = null;
  if (action === "remove") {
    const reasonCategory = opts.reasonCategory ?? "reported";
    ({ removedReignId } = await removeCurrentKing(reign.throneId, { reason: "removed", reasonCategory, actor, reignId }));
    if (!reign.hidden) await setReignHidden(reignId, true, actor);
    if (removedReignId) {
      onKingRemoved({ reignId, reasonCategory, notify: !!opts.notify }).catch((err) =>
        console.error("[reports] onKingRemoved failed", err),
      );
    }
  } else if (reign.blurred) {
    await setReignBlurred(reignId, false);
  }

  const status = action === "approve" ? "approved" : "removed";
  const resolved = await db.transaction(async (tx) => {
    const rows = await tx
      .update(reports)
      .set({ status, resolvedBy: actor, resolvedAt: clockNow() })
      .where(and(eq(reports.reignId, reignId), eq(reports.status, "pending")))
      .returning({ id: reports.id });
    await tx.insert(auditLog).values({
      actor,
      action: `reports.${action}`,
      target: reignId,
      after: { resolved: rows.length, removedReignId },
    });
    return rows.length;
  });
  return { resolved, removedReignId };
}
