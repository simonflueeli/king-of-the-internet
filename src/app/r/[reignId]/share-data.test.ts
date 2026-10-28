import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { EndReason, ThroneId } from "@/lib/contracts";
import { titleFor } from "@/lib/pricing";
import { formatReignLength } from "@/components/share/format";
import { GET as ogReignGET } from "@/app/og/r/[reignId]/route";
import { resetClock, setNow } from "@/server/clock";
import { createTestDb, setTestDb, type Database } from "@/server/db/client";
import { reigns } from "@/server/db/schema";
import { loadShare } from "./share-data";

let db: Database;

async function reign(throne: ThroneId, name: string, startedAt: string, opts?: { endedAt?: string; endReason?: EndReason; hidden?: boolean; blurred?: boolean }) {
  const [r] = await db
    .insert(reigns)
    .values({
      throneId: throne,
      name,
      proclamation: "Bow before me",
      paidCents: 15_000,
      title: titleFor(15_000),
      crestSeed: 0,
      startedAt: new Date(startedAt),
      endedAt: opts?.endedAt ? new Date(opts.endedAt) : null,
      endReason: opts?.endReason ?? null,
      hidden: opts?.hidden ?? false,
      blurred: opts?.blurred ?? false,
    })
    .returning();
  return r;
}

describe("share page data", () => {
  beforeEach(async () => {
    db = await createTestDb();
    setTestDb(db);
    setNow("2026-05-01T12:00:00Z");
  });
  afterAll(() => {
    setTestDb(null);
    resetClock();
  });

  it("live reign: reigning now", async () => {
    const r = await reign("eternal", "Max", "2026-05-01T11:00:00Z");
    const d = await loadShare(r.id);
    expect(d).toMatchObject({ kind: "shown", live: true, proclamation: "Bow before me" });
    if (d?.kind !== "shown") throw new Error();
    expect(d.reign.name).toBe("Max");
    expect(d.reign.title).toBe("Duke");
    expect(d.lengthMs).toBe(3_600_000);
  });

  it("ended reign: ruled for 2h 03m", async () => {
    const r = await reign("eternal", "Max", "2026-05-01T08:00:00Z", { endedAt: "2026-05-01T10:03:30Z", endReason: "takeover" });
    const d = await loadShare(r.id);
    if (d?.kind !== "shown") throw new Error("expected shown");
    expect(d.live).toBe(false);
    expect(formatReignLength(d.lengthMs)).toBe("2h 03m");
  });

  it("daily king from before today's reset is no longer live", async () => {
    const r = await reign("daily", "Max", "2026-04-30T20:00:00Z");
    const d = await loadShare(r.id);
    if (d?.kind !== "shown") throw new Error("expected shown");
    expect(d.live).toBe(false);
    expect(formatReignLength(d.lengthMs)).toBe("4h 00m");
  });

  it("FR-73: hidden and removed reigns are not shown and leak no name", async () => {
    const hidden = await reign("eternal", "Slur", "2026-05-01T11:00:00Z", { hidden: true });
    const removed = await reign("daily", "Spam", "2026-05-01T09:00:00Z", { endedAt: "2026-05-01T10:00:00Z", endReason: "removed" });
    expect(await loadShare(hidden.id)).toEqual({ kind: "hidden", throne: "eternal" });
    expect(await loadShare(removed.id)).toEqual({ kind: "hidden", throne: "daily" });
  });

  it("blurred proclamations are not shown", async () => {
    const r = await reign("eternal", "Max", "2026-05-01T11:00:00Z", { blurred: true });
    const d = await loadShare(r.id);
    expect(d).toMatchObject({ kind: "shown", proclamation: null });
  });

  it("unknown or malformed ids → null", async () => {
    expect(await loadShare("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await loadShare("nope")).toBeNull();
  });

  it("OG image renders a 1200×630 PNG, generic once hidden", async () => {
    const r = await reign("eternal", "Max", "2026-05-01T11:00:00Z");
    const ctx = { params: Promise.resolve({ reignId: r.id }) };
    const res = await ogReignGET(new Request(`http://localhost/og/r/${r.id}`), ctx);
    expect(res.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);

    await db.update(reigns).set({ hidden: true }).where(eq(reigns.id, r.id));
    const hidden = Buffer.from(await (await ogReignGET(new Request(`http://localhost/og/r/${r.id}`), ctx)).arrayBuffer());
    expect(hidden.equals(png)).toBe(false);
  });
});
