import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as reportRoute } from "@/app/api/reports/route";
import { crownWithPayment } from "../admin/test-fixtures";
import { advance, resetClock, setNow } from "../clock";
import { createTestDb, setTestDb, type Database } from "../db/client";
import { reigns, reports } from "../db/schema";
import { getThroneState } from "../throne/state";
import { decideReports, listReportQueue } from "./reports";

let db: Database;

function report(ip: string, body: Record<string, unknown>, origin = "http://localhost:3000") {
  return reportRoute(
    new Request("http://localhost:3000/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, origin, host: "localhost:3000" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/reports", () => {
  beforeEach(async () => {
    db = await createTestDb();
    setTestDb(db);
    setNow("2026-03-01T12:00:00Z");
  });
  afterAll(() => {
    setTestDb(null);
    resetClock();
  });

  it("3 reports from different IPs within 10 minutes blur the proclamation", async () => {
    const { reign } = await crownWithPayment("eternal", "Loud", 500, { proclamation: "something nasty" });
    expect((await report("10.0.0.1", { reignId: reign.id, reason: "offensive" })).status).toBe(201);
    advance(4 * 60_000);
    expect((await report("10.0.0.2", { reignId: reign.id, reason: "spam", details: "  ad  " })).status).toBe(201);
    expect((await getThroneState("eternal")).king?.proclamationBlurred).toBe(false);
    advance(4 * 60_000);
    expect((await report("10.0.0.3", { reignId: reign.id, reason: "other" })).status).toBe(201);
    expect((await getThroneState("eternal")).king?.proclamationBlurred).toBe(true);

    const [row] = await db.select().from(reports).where(eq(reports.reason, "spam"));
    expect(row.details).toBe("ad");
    expect(row.reporterIpHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the same IP three times, or reports spread over more than 10 minutes, do not blur", async () => {
    const { reign } = await crownWithPayment("daily", "Quiet", 500, { proclamation: "hello" });
    for (let i = 0; i < 3; i++) await report("10.0.0.9", { reignId: reign.id, reason: "offensive" });
    expect(await db.select().from(reports)).toHaveLength(1); // one pending report per IP and reign
    await report("10.0.0.10", { reignId: reign.id, reason: "offensive" });
    advance(11 * 60_000);
    await report("10.0.0.11", { reignId: reign.id, reason: "offensive" });
    expect((await getThroneState("daily")).king?.proclamationBlurred).toBe(false);
  });

  it("validates input, rate-limits per IP and checks the origin", async () => {
    const { reign } = await crownWithPayment("eternal", "X", 200);
    expect((await report("10.1.0.1", { reignId: reign.id, reason: "nope" })).status).toBe(422);
    expect((await report("10.1.0.1", { reignId: "00000000-0000-4000-8000-000000000000", reason: "spam" })).status).toBe(404);
    expect((await report("10.1.0.1", { reignId: reign.id, reason: "spam" }, "https://evil.example")).status).toBe(403);

    const others = await Promise.all(
      Array.from({ length: 5 }, (_, i) => crownWithPayment("daily", `R${i}`, 200 + i * 100).then((x) => x.reign.id)),
    );
    for (const id of others) expect((await report("10.2.0.1", { reignId: id, reason: "spam" })).status).toBe(201);
    const limited = await report("10.2.0.1", { reignId: reign.id, reason: "spam" });
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe("rate_limited");
  });

  it("admin approve unblurs; remove ends the current reign and hides it", async () => {
    const { reign } = await crownWithPayment("eternal", "Blurry", 500, { proclamation: "x" });
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) await report(ip, { reignId: reign.id, reason: "offensive" });
    expect((await listReportQueue())[0]).toMatchObject({ reignId: reign.id, count: 3, distinctIps: 3, current: true, blurred: true });

    expect(await decideReports(reign.id, "approve", "admin@localhost")).toMatchObject({ resolved: 3 });
    const [approved] = await db.select().from(reigns).where(eq(reigns.id, reign.id));
    expect(approved.blurred).toBe(false);
    expect(await listReportQueue()).toEqual([]);

    await report("4.4.4.4", { reignId: reign.id, reason: "impersonation" });
    const res = await decideReports(reign.id, "remove", "admin@localhost", { reasonCategory: "impersonation" });
    expect(res).toEqual({ resolved: 1, removedReignId: reign.id });
    const [removed] = await db.select().from(reigns).where(eq(reigns.id, reign.id));
    expect(removed).toMatchObject({ hidden: true, endReason: "removed" });
    expect((await getThroneState("eternal")).king).toBeNull();
  });
});
