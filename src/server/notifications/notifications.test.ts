import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThroneId } from "@/lib/contracts";
import { titleFor } from "@/lib/pricing";
import { GET as reclaimGET } from "@/app/api/reclaim/route";
import { GET as unsubscribeGET, POST as unsubscribePOST } from "@/app/api/unsubscribe/route";
import { advance, now, resetClock, setNow } from "../clock";
import { createTestDb, setTestDb, type Database } from "../db/client";
import { analyticsEvents, customers, emailLog, reigns, reservations, thrones } from "../db/schema";
import { FakeEmailProvider, setEmailProvider } from "../email/provider";
import { flushNotifications, onKingRemoved, onRefundIssued, onTakeoverCommitted } from ".";

let db: Database;
let mail: FakeEmailProvider;

async function customer(email: string, alertOptIn = true) {
  const [c] = await db
    .insert(customers)
    .values({ email, alertOptIn, alertOptInAt: alertOptIn ? now() : null, createdAt: now() })
    .onConflictDoUpdate({ target: customers.email, set: { alertOptIn } })
    .returning();
  return c;
}

/** Crown directly in the DB (C's crown transaction is not merged yet) and notify like C will. */
async function takeover(throne: ThroneId, name: string, paidCents: number, email: string, opts?: { alertOptIn?: boolean }) {
  const alertOptIn = opts?.alertOptIn ?? true;
  const c = await customer(email, alertOptIn);
  const at = now();
  const { reign, previousReignId } = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(thrones).where(eq(thrones.id, throne)).for("update");
    if (row.currentReignId) {
      await tx.update(reigns).set({ endedAt: at, endReason: "takeover" }).where(eq(reigns.id, row.currentReignId));
    }
    const [reign] = await tx
      .insert(reigns)
      .values({ throneId: throne, customerId: c.id, name, paidCents, title: titleFor(paidCents), crestSeed: 0, startedAt: at })
      .returning();
    await tx.insert(reservations).values({
      throneId: throne,
      minCents: paidCents,
      amountCents: paidCents,
      throneVersion: row.version,
      state: "completed",
      expiresAt: at,
      reservationTokenHash: "x",
      email,
      alertOptIn,
      reignId: reign.id,
    });
    await tx
      .update(thrones)
      .set({ currentReignId: reign.id, lastPaidCents: paidCents, crownedAt: at, version: row.version + 1 })
      .where(eq(thrones.id, throne));
    return { reign, previousReignId: row.currentReignId };
  });
  await onTakeoverCommitted({ throne, reignId: reign.id, previousReignId });
  await flushNotifications();
  return reign;
}

function linkFrom(text: string, path: string): string {
  const m = text.match(new RegExp(`https?://[^\\s]+${path.replace("/", "\\/")}\\?token=[^\\s]+`));
  if (!m) throw new Error(`no ${path} link in:\n${text}`);
  return m[0];
}

describe("notifications", () => {
  beforeEach(async () => {
    db = await createTestDb();
    setTestDb(db);
    mail = new FakeEmailProvider();
    setEmailProvider(mail);
    setNow("2026-05-01T12:00:00Z");
  });
  afterEach(() => setEmailProvider(null));
  afterAll(() => {
    setTestDb(null);
    resetClock();
  });

  it("sends a receipt to the new king", async () => {
    const r = await takeover("eternal", "Max", 15_000, "max@example.com");
    const [receipt] = mail.ofType("receipt");
    expect(receipt.to).toBe("max@example.com");
    expect(receipt.subject).toContain("Duke Max");
    expect(receipt.text).toContain("Eternal Throne");
    expect(receipt.text).toContain("€150.00");
    expect(receipt.text).toContain("1 May 2026, 12:00 UTC");
    expect(receipt.text).toContain(`/r/${r.id}`);
    expect(receipt.text).toContain("VAT");
  });

  it("AC-16: opted-in king overthrown → overthrow email within 60 s with a working reclaim link", async () => {
    const old = await takeover("daily", "Alice", 200, "alice@example.com");
    const overthrownAt = now();
    advance(5 * 60_000);
    await takeover("daily", "Bob", 220, "bob@example.com");

    const [email] = mail.ofType("overthrow");
    expect(email.to).toBe("alice@example.com");
    expect(email.subject).toBe("You’ve been overthrown");
    expect(email.text).toContain("Lord Bob just took your seat on the daily throne. Win it back for €2.42 before they get comfortable.");
    expect(email.html).toContain("Reclaim my throne");
    expect(email.headers?.["List-Unsubscribe"]).toMatch(/^<http.*\/api\/unsubscribe\?token=.+>$/);
    expect(email.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    const [log] = await db.select().from(emailLog).where(eq(emailLog.type, "overthrow"));
    expect(log.status).toBe("sent");
    expect(log.reignId).toBe(old.id);
    expect(log.sentAt.getTime() - now().getTime()).toBeLessThan(60_000);

    // The old king clicks 3 minutes later.
    advance(3 * 60_000);
    const res = await reclaimGET(new Request(linkFrom(email.text, "/api/reclaim")));
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/daily");
    expect(loc.searchParams.get("checkout")).toBe("1");
    expect(loc.searchParams.get("name")).toBe("Alice");
    expect(overthrownAt.getTime()).toBeLessThan(now().getTime());

    const [ev] = await db.select().from(analyticsEvents).where(eq(analyticsEvents.name, "overthrow_email_clicked"));
    expect(ev.props).toEqual({ throne: "daily", minutes_since_overthrow: 3 });
  });

  it("AC-17: same recipient overthrown 3 times in 10 minutes → only the first email is sent", async () => {
    await takeover("eternal", "Alice", 200, "alice@example.com");
    advance(60_000);
    await takeover("eternal", "Bob", 220, "bob@example.com"); // Alice overthrown #1
    advance(2 * 60_000);
    await takeover("eternal", "Alice", 300, "alice@example.com");
    advance(2 * 60_000);
    await takeover("eternal", "Carol", 330, "carol@example.com"); // Alice overthrown #2
    advance(2 * 60_000);
    await takeover("eternal", "Alice", 400, "alice@example.com");
    advance(2 * 60_000);
    await takeover("eternal", "Dave", 440, "dave@example.com"); // Alice overthrown #3 (9 min after #1)

    const toAlice = mail.ofType("overthrow").filter((m) => m.to === "alice@example.com");
    expect(toAlice).toHaveLength(1);
    expect(toAlice[0].text).toContain("Lord Bob");
    const [alice] = await db.select().from(customers).where(eq(customers.email, "alice@example.com"));
    const rows = await db.select().from(emailLog).where(eq(emailLog.customerId, alice.id));
    expect(rows.filter((r) => r.type === "overthrow").map((r) => r.status).sort()).toEqual(["dropped", "dropped", "sent"]);

    // After the window a new overthrow emails again; Bob/Carol each got their own first email.
    advance(16 * 60_000);
    await takeover("eternal", "Alice", 500, "alice@example.com");
    advance(60_000);
    await takeover("eternal", "Eve", 550, "eve@example.com");
    expect(mail.ofType("overthrow").filter((m) => m.to === "alice@example.com")).toHaveLength(2);
  });

  it("the window is per throne", async () => {
    await takeover("eternal", "Alice", 200, "alice@example.com");
    await takeover("daily", "Alice", 200, "alice@example.com");
    advance(60_000);
    await takeover("eternal", "Bob", 220, "bob@example.com");
    await takeover("daily", "Bob", 220, "bob@example.com");
    expect(mail.ofType("overthrow").filter((m) => m.to === "alice@example.com")).toHaveLength(2);
  });

  it("skips the overthrow email when the new king has the same email", async () => {
    await takeover("eternal", "Alice", 200, "alice@example.com");
    advance(60_000);
    await takeover("eternal", "Queen Alice", 1_000, " Alice@Example.com ".trim().toLowerCase());
    expect(mail.ofType("overthrow")).toHaveLength(0);
    expect(mail.ofType("receipt")).toHaveLength(2);
  });

  it("skips kings who did not opt in", async () => {
    await takeover("eternal", "Alice", 200, "alice@example.com", { alertOptIn: false });
    advance(60_000);
    await takeover("eternal", "Bob", 220, "bob@example.com");
    expect(mail.ofType("overthrow")).toHaveLength(0);
  });

  it("unsubscribe (GET link) stops further overthrow emails on all thrones", async () => {
    await takeover("eternal", "Alice", 200, "alice@example.com");
    advance(60_000);
    await takeover("eternal", "Bob", 220, "bob@example.com");
    const [email] = mail.ofType("overthrow");

    const res = await unsubscribeGET(new Request(linkFrom(email.text, "/api/unsubscribe")));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("You’re unsubscribed");
    const [alice] = await db.select().from(customers).where(eq(customers.email, "alice@example.com"));
    expect(alice.unsubscribedAt).not.toBeNull();

    advance(30 * 60_000);
    await takeover("daily", "Alice", 200, "alice@example.com");
    await takeover("eternal", "Alice", 300, "alice@example.com");
    advance(60_000);
    await takeover("daily", "Carol", 220, "carol@example.com");
    await takeover("eternal", "Carol", 330, "carol@example.com");
    expect(mail.ofType("overthrow").filter((m) => m.to === "alice@example.com")).toHaveLength(1);
  });

  it("unsubscribe accepts RFC 8058 one-click POST and rejects bad tokens", async () => {
    await takeover("eternal", "Alice", 200, "alice@example.com");
    advance(60_000);
    await takeover("eternal", "Bob", 220, "bob@example.com");
    const url = mail.ofType("overthrow")[0].headers!["List-Unsubscribe"].slice(1, -1);
    const res = await unsubscribePOST(new Request(url, { method: "POST", body: "List-Unsubscribe=One-Click" }));
    expect(res.status).toBe(200);
    const [alice] = await db.select().from(customers).where(eq(customers.email, "alice@example.com"));
    expect(alice.unsubscribedAt).not.toBeNull();

    const bad = await unsubscribeGET(new Request("http://localhost:3000/api/unsubscribe?token=nope.nope"));
    expect(bad.status).toBe(400);
  });

  it("reclaim tokens expire after 7 days and tampered tokens are ignored", async () => {
    await takeover("daily", "Alice", 200, "alice@example.com");
    advance(60_000);
    await takeover("daily", "Bob", 220, "bob@example.com");
    const link = linkFrom(mail.ofType("overthrow")[0].text, "/api/reclaim");

    advance(7 * 86_400_000 - 120_000);
    const stillValid = new URL((await reclaimGET(new Request(link))).headers.get("location")!);
    expect(stillValid.searchParams.get("name")).toBe("Alice");

    advance(120_000);
    const expired = await reclaimGET(new Request(link));
    expect(expired.status).toBe(302);
    const loc = new URL(expired.headers.get("location")!);
    expect(loc.pathname).toBe("/");
    expect(loc.search).toBe("");

    const tampered = await reclaimGET(new Request(link.replace(/token=./, "token=x")));
    expect(new URL(tampered.headers.get("location")!).search).toBe("");
  });

  it("never throws and logs a failure when the provider is down", async () => {
    await takeover("eternal", "Alice", 200, "alice@example.com");
    advance(60_000);
    mail.failNext = 10;
    await expect(takeover("eternal", "Bob", 220, "bob@example.com")).resolves.toBeDefined();
    const rows = await db.select().from(emailLog);
    expect(rows.filter((r) => r.status === "failed").map((r) => r.type).sort()).toEqual(["overthrow", "receipt"]);
    await expect(onTakeoverCommitted({ throne: "eternal", reignId: "not-a-uuid", previousReignId: null })).resolves.toBeUndefined();
    await flushNotifications();
  });

  it("does not send twice when C reports the same takeover twice", async () => {
    await takeover("eternal", "Alice", 200, "alice@example.com");
    advance(60_000);
    const bob = await takeover("eternal", "Bob", 220, "bob@example.com");
    const [alice] = await db.select().from(reigns).where(eq(reigns.name, "Alice"));
    advance(20 * 60_000);
    await onTakeoverCommitted({ throne: "eternal", reignId: bob.id, previousReignId: alice.id });
    await flushNotifications();
    expect(mail.ofType("overthrow")).toHaveLength(1);
    expect(mail.ofType("receipt")).toHaveLength(2);
  });

  it("removal notice and refund confirmation", async () => {
    const r = await takeover("eternal", "Alice", 200, "alice@example.com");
    await onKingRemoved({ reignId: r.id, reasonCategory: "impersonation", notify: false });
    await onKingRemoved({ reignId: r.id, reasonCategory: "impersonation", notify: true });
    await onRefundIssued({ reignId: r.id, amountCents: 200 });
    await flushNotifications();
    const [removal] = mail.ofType("removal");
    expect(mail.ofType("removal")).toHaveLength(1);
    expect(removal.text).toContain("Your reign as Lord Alice on the eternal throne was ended under our Terms. Reason: Impersonation.");
    const [refund] = mail.ofType("refund");
    expect(refund.text).toContain("We’ve refunded €2.00");
    expect(refund.text).toContain("5–10 business days");
  });

  it("escapes user text in HTML", async () => {
    await takeover("eternal", "Alice", 200, "alice@example.com");
    advance(60_000);
    await takeover("eternal", `<b>"Bob"</b>`, 220, "bob@example.com");
    const [email] = mail.ofType("overthrow");
    expect(email.html).not.toContain("<b>");
    expect(email.html).toContain("&lt;b&gt;&quot;Bob&quot;&lt;/b&gt;");
  });
});
