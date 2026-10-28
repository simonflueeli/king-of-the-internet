"use server";
// OWNER: G. Dev-only: simulate two takeovers straight in the DB (bypassing reservations and
// payments) and run the real notification code, so the outbox shows a receipt and an overthrow
// email. Never available in production.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { ThroneId } from "@/lib/contracts";
import { crestHash } from "@/lib/crest";
import { nextMinCents, titleFor } from "@/lib/pricing";
import { now } from "@/server/clock";
import { getConfig, pricingConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { customers, emailLog, reigns, reservations, thrones } from "@/server/db/schema";
import { normalizeEmail } from "@/server/hash";
import { flushNotifications, onTakeoverCommitted } from "@/server/notifications";

async function devTakeover(throne: ThroneId, name: string, email: string): Promise<{ reignId: string; previousReignId: string | null }> {
  const db = await getDb();
  const cfg = await getConfig();
  const at = now();
  const [c] = await db
    .insert(customers)
    .values({ email: normalizeEmail(email), alertOptIn: true, alertOptInAt: at })
    .onConflictDoUpdate({ target: customers.email, set: { alertOptIn: true, alertOptInAt: at } })
    .returning();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(thrones).where(eq(thrones.id, throne)).for("update");
    const paid = row.lastPaidCents ? nextMinCents(row.lastPaidCents, pricingConfig(cfg)) : cfg.baseCents;
    if (row.currentReignId) {
      await tx.update(reigns).set({ endedAt: at, endReason: "takeover" }).where(eq(reigns.id, row.currentReignId));
    }
    const [reign] = await tx
      .insert(reigns)
      .values({ throneId: throne, customerId: c.id, name, paidCents: paid, title: titleFor(paid), crestSeed: crestHash(name.toLowerCase()), startedAt: at })
      .returning();
    await tx.insert(reservations).values({
      throneId: throne,
      minCents: paid,
      amountCents: paid,
      throneVersion: row.version,
      state: "completed",
      expiresAt: at,
      reservationTokenHash: "dev-simulated",
      name,
      email: c.email,
      alertOptIn: true,
      termsAcceptedAt: at,
      reignId: reign.id,
    });
    await tx
      .update(thrones)
      .set({ currentReignId: reign.id, lastPaidCents: paid, crownedAt: at, removedAt: null, version: row.version + 1, updatedAt: at })
      .where(eq(thrones.id, throne));
    return { reignId: reign.id, previousReignId: row.currentReignId };
  });
}

export async function simulateOverthrow(form: FormData): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("not available");
  const throne: ThroneId = form.get("throne") === "daily" ? "daily" : "eternal";
  const str = (k: string, d: string) => String(form.get(k) ?? "").trim().slice(0, 64) || d;

  const first = await devTakeover(throne, str("oldName", "Alice"), str("oldEmail", "alice@example.test"));
  await onTakeoverCommitted({ throne, ...first });
  const second = await devTakeover(throne, str("newName", "Bob"), str("newEmail", "bob@example.test"));
  await onTakeoverCommitted({ throne, ...second });
  await flushNotifications();

  const db = await getDb();
  const [log] = await db.select().from(emailLog).where(and(eq(emailLog.reignId, first.reignId), eq(emailLog.type, "overthrow")));
  const target = log?.providerMessageId ?? null;
  redirect(target ? `/dev/outbox?id=${target}` : "/dev/outbox");
}
