// OWNER: C. "At most 3 unpaid reservations per IP address and per device id in 10 minutes"
// (PRD "Checkout and payment" → Rules). DB-based: counts reservation rows, so it holds across
// restarts and needs no extra infrastructure. Runs inside the reservation transaction.
import { and, eq, gt, ne, sql } from "drizzle-orm";
import type { AppConfig } from "../config";
import type { Tx } from "../db/client";
import { reservations } from "../db/schema";

export async function isRateLimited(
  tx: Tx,
  who: { ipHash: string | null; deviceId: string | null },
  cfg: Pick<AppConfig, "rateLimitCount" | "rateLimitWindowMs">,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - cfg.rateLimitWindowMs);
  const unpaid = and(gt(reservations.createdAt, since), ne(reservations.state, "completed"));
  const count = async (match: ReturnType<typeof eq>) => {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reservations)
      .where(and(match, unpaid));
    return Number(r.n);
  };
  if (who.ipHash && (await count(eq(reservations.clientIpHash, who.ipHash))) >= cfg.rateLimitCount) return true;
  if (who.deviceId && (await count(eq(reservations.deviceId, who.deviceId))) >= cfg.rateLimitCount) return true;
  return false;
}
