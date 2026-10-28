import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, setTestDb, type Database } from "@/server/db/client";
import { analyticsEvents } from "@/server/db/schema";
import { POST } from "./route";

let db: Database;

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost:3000/api/events", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    }),
  );

describe("POST /api/events", () => {
  beforeEach(async () => {
    db = await createTestDb();
    setTestDb(db);
  });
  afterAll(() => setTestDb(null));

  it("stores allow-listed events", async () => {
    const res = await post({ name: "checkout_opened", props: { throne: "daily", source: "tryon", min_cents: 220 } });
    expect(res.status).toBe(204);
    const rows = await db.select().from(analyticsEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "checkout_opened", props: { throne: "daily", source: "tryon", min_cents: 220 } });
  });

  it("rejects unknown events, nested props, bad JSON and foreign origins", async () => {
    expect((await post({ name: "steal_cookies" })).status).toBe(400);
    expect((await post({ name: "page_view", props: { a: { b: 1 } } })).status).toBe(400);
    expect((await post({ name: "page_view", props: { "bad key": 1 } })).status).toBe(400);
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ name: "page_view" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ name: "page_view", props: { x: "y".repeat(5000) } })).status).toBe(413);
    expect(await db.select().from(analyticsEvents)).toHaveLength(0);
  });

  it("truncates long strings", async () => {
    await post({ name: "takeover_failed", props: { reason: "x".repeat(300) } });
    const [row] = await db.select().from(analyticsEvents);
    expect((row.props as { reason: string }).reason).toHaveLength(200);
  });
});
