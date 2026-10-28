// OWNER: C. Test helpers for the throne tests (not used by the app). Fresh in-memory DB, fresh
// fake payment provider and frozen clock per test; buy() walks the real reservation → confirm →
// authorize → crown path.
import { sql } from "drizzle-orm";
import type { ThroneId } from "@/lib/contracts";
import { resetClock, setNow } from "../clock";
import { invalidateConfigCache } from "../config";
import { createTestDb, setTestDb, type Database } from "../db/client";
import { payments, reigns, reservations } from "../db/schema";
import { FakePaymentProvider } from "../payments/fake";
import { setPaymentProvider } from "../payments/provider";
import { handleAuthorized } from "./crown";
import { resetPresence } from "./presence";
import { confirmReservation, createReservation, type Requester } from "./reservations";

export interface Kit {
  db: Database;
  pay: FakePaymentProvider;
}

export async function setupKit(start = "2026-03-01T12:00:00Z"): Promise<Kit> {
  const db = await createTestDb();
  setTestDb(db);
  const pay = new FakePaymentProvider();
  setPaymentProvider(pay);
  invalidateConfigCache();
  resetPresence();
  setNow(start);
  return { db, pay };
}

export function teardownKit(): void {
  setTestDb(null);
  setPaymentProvider(null);
  resetClock();
  resetPresence();
}

let ipCounter = 0;
/** A distinct requester per call, so rate limits never interfere unless a test wants them to. */
export function someone(): Requester {
  ipCounter += 1;
  return { ipHash: `ip-${ipCounter}`, deviceId: `device-${ipCounter}-abcdefghijklmnop` };
}

export function confirmBody(amountCents: number, name: string, extra: Partial<{ proclamation: string; email: string; alertOptIn: boolean }> = {}) {
  return {
    amountCents,
    name,
    proclamation: extra.proclamation ?? "",
    email: extra.email ?? `${name.toLowerCase().replace(/\W+/g, "")}@example.com`,
    alertOptIn: extra.alertOptIn ?? true,
    termsAccepted: true,
  };
}

/** Full takeover through the service layer. Pays the minimum unless `amountCents` is given. */
export async function buy(kit: Kit, throne: ThroneId, name: string, amountCents?: number) {
  const who = someone();
  const res = await createReservation(throne, who);
  const amount = amountCents ?? res.minCents;
  await confirmReservation(res.reservationId, res.reservationToken, confirmBody(amount, name), who);
  const intent = kit.pay.forReservation(res.reservationId)!;
  kit.pay.authorize(intent.id);
  const outcome = await handleAuthorized(intent.id);
  return { res, amount, intent, outcome };
}

export async function count(db: Database, table: typeof reigns | typeof payments | typeof reservations): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return Number(r.n);
}
