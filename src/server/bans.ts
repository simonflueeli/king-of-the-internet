// OWNER: S. Bans by email, card fingerprint, IP or device id, with optional expiry (PRD AD-05).
// Values are stored only as salted hashes (hashBanValue). IP bans are keyed on the salted IP hash
// (hashIp) because that is all the app ever stores about an IP — callers pass `ipHash`.
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { now as clockNow } from "./clock";
import { getDb, type DbOrTx } from "./db/client";
import { auditLog, bans, type BanKind } from "./db/schema";
import { hashBanValue, hashIp } from "./hash";

export const BAN_KINDS: readonly BanKind[] = ["email", "card", "ip", "device"];

export function isBanKind(v: unknown): v is BanKind {
  return typeof v === "string" && (BAN_KINDS as readonly string[]).includes(v);
}

/**
 * bans.value_hash for a value. `ip` accepts a raw IP or an already salted IP hash (64 hex chars,
 * as stored on reservations/reports), so admins can ban an IP they only know by its hash.
 */
export function banValueHash(kind: BanKind, value: string): string {
  const v = value.trim();
  if (kind === "ip") return hashBanValue("ip", /^[0-9a-f]{64}$/.test(v) ? v : hashIp(v));
  return hashBanValue(kind, v);
}

const active = (at: Date) => or(isNull(bans.expiresAt), gt(bans.expiresAt, at));

export async function checkBans(q: {
  email?: string;
  ipHash?: string;
  deviceId?: string;
  cardFingerprint?: string;
}): Promise<{ banned: boolean; reason?: string }> {
  const keys: { kind: BanKind; hash: string }[] = [];
  if (q.email?.trim()) keys.push({ kind: "email", hash: hashBanValue("email", q.email) });
  if (q.ipHash) keys.push({ kind: "ip", hash: hashBanValue("ip", q.ipHash) });
  if (q.deviceId) keys.push({ kind: "device", hash: hashBanValue("device", q.deviceId) });
  if (q.cardFingerprint) keys.push({ kind: "card", hash: hashBanValue("card", q.cardFingerprint) });
  if (!keys.length) return { banned: false };

  const db = await getDb();
  const [hit] = await db
    .select({ kind: bans.kind, reason: bans.reason })
    .from(bans)
    .where(
      and(
        inArray(bans.valueHash, keys.map((k) => k.hash)),
        inArray(bans.kind, [...new Set(keys.map((k) => k.kind))]),
        active(clockNow()),
      ),
    )
    .limit(1);
  // value hashes are namespaced per kind, so a hash match implies the right kind
  return hit ? { banned: true, reason: hit.reason ?? `banned ${hit.kind}` } : { banned: false };
}

export interface CreateBanInput {
  kind: BanKind;
  value: string; // raw value (email, card fingerprint, IP or IP hash, device id)
  reason?: string | null;
  expiresAt?: Date | null; // null = permanent
  actor: string;
}

/**
 * Creates a ban, or extends an active one for the same value (never shortens it). Writes audit_log.
 * Pass `conn` to run inside an existing transaction.
 */
export async function createBan(input: CreateBanInput, conn?: DbOrTx) {
  const valueHash = banValueHash(input.kind, input.value);
  const at = clockNow();
  const run = async (tx: DbOrTx) => {
    const [existing] = await tx
      .select()
      .from(bans)
      .where(and(eq(bans.kind, input.kind), eq(bans.valueHash, valueHash), active(at)))
      .orderBy(sql`${bans.expiresAt} desc nulls first`)
      .limit(1);
    if (existing) {
      const longer = existing.expiresAt !== null && (input.expiresAt == null || input.expiresAt > existing.expiresAt);
      if (!longer) return existing;
      const [updated] = await tx
        .update(bans)
        .set({ expiresAt: input.expiresAt ?? null })
        .where(eq(bans.id, existing.id))
        .returning();
      await tx.insert(auditLog).values({
        actor: input.actor,
        action: "ban.extend",
        target: existing.id,
        before: { expiresAt: existing.expiresAt },
        after: { expiresAt: input.expiresAt ?? null, reason: input.reason ?? null },
      });
      return updated;
    }
    const [row] = await tx
      .insert(bans)
      .values({
        kind: input.kind,
        valueHash,
        reason: input.reason ?? null,
        expiresAt: input.expiresAt ?? null,
        createdBy: input.actor,
      })
      .returning();
    await tx.insert(auditLog).values({
      actor: input.actor,
      action: "ban.create",
      target: row.id,
      after: { kind: row.kind, reason: row.reason, expiresAt: row.expiresAt },
    });
    return row;
  };
  if (conn) return run(conn);
  const db = await getDb();
  return db.transaction(run);
}

/** Lifts a ban by expiring it now (the row stays for the record). */
export async function liftBan(id: string, actor: string): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const at = clockNow();
    const [row] = await tx.select().from(bans).where(eq(bans.id, id));
    if (!row || (row.expiresAt && row.expiresAt <= at)) return false;
    await tx.update(bans).set({ expiresAt: at }).where(eq(bans.id, id));
    await tx.insert(auditLog).values({
      actor,
      action: "ban.lift",
      target: id,
      before: { expiresAt: row.expiresAt },
      after: { expiresAt: at },
    });
    return true;
  });
}

export async function listBans(opts: { includeExpired?: boolean; limit?: number } = {}) {
  const db = await getDb();
  return db
    .select()
    .from(bans)
    .where(opts.includeExpired ? undefined : active(clockNow()))
    .orderBy(desc(bans.createdAt))
    .limit(opts.limit ?? 200);
}
