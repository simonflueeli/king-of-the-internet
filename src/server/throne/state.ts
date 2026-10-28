// OWNER: C. Read side of the thrones: the public ThroneState, single reigns and paginated history.
// Everything is computed from the DB with the server clock; nothing here writes.
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { ReignDTO, ThroneId, ThroneState } from "@/lib/contracts";
import { idleDays, minPriceCents, nextMinCents, nextUtcMidnight } from "@/lib/pricing";
import { now as clockNow } from "../clock";
import { getConfig, pricingConfig } from "../config";
import { getDb } from "../db/client";
import { reigns, reservations, thrones } from "../db/schema";
import { watchingCount } from "./presence";
import { OPEN_STATES, isLive } from "./rules";

type ReignRow = typeof reigns.$inferSelect;

export const THRONE_IDS: readonly ThroneId[] = ["eternal", "daily"];
export const RECENT_REIGNS = 12;
export const HISTORY_PAGE_SIZE = 50;

export function isThroneId(v: string): v is ThroneId {
  return (THRONE_IDS as readonly string[]).includes(v);
}

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Start of the UTC day containing `d`. */
export function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function toReignDTO(r: ReignRow, now: Date): ReignDTO {
  const end = r.endedAt ?? now;
  return {
    id: r.id,
    throne: r.throneId,
    name: r.name,
    proclamation: r.proclamation || null,
    proclamationBlurred: r.blurred,
    paidCents: r.paidCents,
    title: r.title,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    endReason: r.endReason ?? null,
    lengthMs: Math.max(0, end.getTime() - r.startedAt.getTime()),
  };
}

export async function getThroneState(throne: ThroneId): Promise<ThroneState> {
  const cfg = await getConfig();
  const conn = await getDb();
  const now = clockNow();
  const dayStart = utcDayStart(now);

  const [row] = await conn.select().from(thrones).where(eq(thrones.id, throne));
  if (!row) throw new Error(`unknown throne ${throne}`);

  // Statistics scope: eternal = all time, daily = reigns started today (UTC).
  const scope = throne === "daily"
    ? and(eq(reigns.throneId, throne), gte(reigns.startedAt, dayStart))
    : eq(reigns.throneId, throne);
  const visible = and(scope, eq(reigns.hidden, false));
  const lengthExpr = sql`coalesce(${reigns.endedAt}, ${now.toISOString()}::timestamptz) - ${reigns.startedAt}`;

  const [current, totals, longest, highest, recent, openReservation] = await Promise.all([
    row.currentReignId
      ? conn.select().from(reigns).where(eq(reigns.id, row.currentReignId)).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    conn
      .select({ count: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${reigns.paidCents}), 0)::bigint` })
      .from(reigns)
      .where(scope),
    conn.select().from(reigns).where(visible).orderBy(desc(lengthExpr), asc(reigns.startedAt)).limit(1),
    conn.select().from(reigns).where(visible).orderBy(desc(reigns.paidCents), asc(reigns.startedAt)).limit(1),
    conn.select().from(reigns).where(visible).orderBy(desc(reigns.startedAt), desc(reigns.id)).limit(RECENT_REIGNS),
    conn
      .select({ state: reservations.state, expiresAt: reservations.expiresAt, lastHeartbeatAt: reservations.lastHeartbeatAt })
      .from(reservations)
      .where(and(eq(reservations.throneId, throne), inArray(reservations.state, [...OPEN_STATES])))
      .limit(1),
  ]);

  // A daily king from before today's reset counts as gone even if the reset job has not run yet.
  const king = current && !(throne === "daily" && current.startedAt < dayStart) ? current : null;

  let vacancy: ThroneState["vacancy"] = null;
  if (!king) {
    if (throne === "daily") {
      const [beforeToday] = await conn
        .select()
        .from(reigns)
        .where(and(eq(reigns.throneId, throne), lt(reigns.startedAt, dayStart)))
        .orderBy(desc(reigns.startedAt))
        .limit(1);
      if (Number(totals[0].count) > 0) vacancy = { reason: "removed", yesterdayRuler: null };
      else if (beforeToday) {
        // "Yesterday's ruler" = whoever sat on the throne when the day ended (not removed / hidden).
        const ruledUntilReset = !beforeToday.hidden && (beforeToday.endReason === "reset" || beforeToday.endedAt === null);
        vacancy = { reason: "reset", yesterdayRuler: ruledUntilReset ? beforeToday.name : null };
      } else vacancy = { reason: "never", yesterdayRuler: null };
    } else {
      vacancy = { reason: row.crownedAt ? "removed" : "never", yesterdayRuler: null };
    }
  }

  const pricing = pricingConfig(cfg);
  const last = row.lastPaidCents != null && row.crownedAt ? { paidCents: row.lastPaidCents, crownedAt: row.crownedAt } : null;
  const minCents = minPriceCents(throne, last, now, pricing);
  const lock = openReservation[0];

  return {
    throne,
    serverNow: now.toISOString(),
    version: row.version,
    king: king ? { ...toReignDTO(king, now), crownedAt: king.startedAt.toISOString() } : null,
    vacancy,
    minCents,
    nextMinCentsAtMinimum: nextMinCents(minCents, pricing),
    idleDays: throne === "eternal" && row.crownedAt ? idleDays(row.crownedAt, now) : 0,
    resetsAt: throne === "daily" ? nextUtcMidnight(now).toISOString() : null,
    reservation: lock && isLive(lock, cfg, now) ? { lockedUntil: lock.expiresAt.toISOString() } : null,
    stats: {
      reignCount: Number(totals[0].count),
      totalPaidCents: Number(totals[0].total),
      longest: longest[0] ? toReignDTO(longest[0], now) : null,
      highest: highest[0] ? toReignDTO(highest[0], now) : null,
    },
    recent: recent.map((r) => toReignDTO(r, now)),
    lastTakeoverAt: row.crownedAt?.toISOString() ?? null,
    watching: watchingCount(throne),
  };
}

/** One reign for share pages / GET /api/reigns/{id}. Hidden reigns come back with name and proclamation blanked. */
export async function getReign(id: string): Promise<(ReignDTO & { hidden: boolean }) | null> {
  if (!isUuid(id)) return null;
  const db = await getDb();
  const [r] = await db.select().from(reigns).where(eq(reigns.id, id));
  if (!r) return null;
  const dto = toReignDTO(r, clockNow());
  return r.hidden ? { ...dto, name: "", proclamation: null, hidden: true } : { ...dto, hidden: false };
}

function encodeCursor(r: ReignRow): string {
  return Buffer.from(`${r.startedAt.toISOString()}|${r.id}`).toString("base64url");
}

function decodeCursor(cursor: string): { startedAt: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const startedAt = new Date(iso ?? "");
  if (!id || !isUuid(id) || Number.isNaN(startedAt.getTime())) return null;
  return { startedAt, id };
}

/** Full history of a throne, newest first, 50 per page, hidden reigns excluded (FR-53). */
export async function listReigns(
  throne: ThroneId,
  cursor: string | null,
): Promise<{ reigns: ReignDTO[]; nextCursor: string | null }> {
  const db = await getDb();
  const now = clockNow();
  const after = cursor ? decodeCursor(cursor) : null;
  const rows = await db
    .select()
    .from(reigns)
    .where(
      and(
        eq(reigns.throneId, throne),
        eq(reigns.hidden, false),
        after
          ? or(lt(reigns.startedAt, after.startedAt), and(eq(reigns.startedAt, after.startedAt), lt(reigns.id, after.id)))
          : undefined,
      ),
    )
    .orderBy(desc(reigns.startedAt), desc(reigns.id))
    .limit(HISTORY_PAGE_SIZE + 1);
  const page = rows.slice(0, HISTORY_PAGE_SIZE);
  return {
    reigns: page.map((r) => toReignDTO(r, now)),
    nextCursor: rows.length > HISTORY_PAGE_SIZE ? encodeCursor(page[page.length - 1]) : null,
  };
}
