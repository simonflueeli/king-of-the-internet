import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as devLoginRoute } from "@/app/api/admin/auth/dev-login/route";
import { POST as registerOptionsRoute } from "@/app/api/admin/auth/register/options/route";
import { POST as banRoute, GET as bansRoute } from "@/app/api/admin/bans/route";
import { PATCH as configRoute } from "@/app/api/admin/config/route";
import { POST as refundRoute } from "@/app/api/admin/payments/[id]/refund/route";
import { POST as hiddenRoute } from "@/app/api/admin/reigns/[id]/hidden/route";
import { GET as thronesRoute } from "@/app/api/admin/thrones/route";
import { POST as removeRoute } from "@/app/api/admin/thrones/[throne]/remove/route";
import { checkBans } from "../bans";
import { advance, resetClock, setNow } from "../clock";
import { invalidateConfigCache } from "../config";
import { createTestDb, setTestDb, type Database } from "../db/client";
import { auditLog, payments, reigns } from "../db/schema";
import { hashIp } from "../hash";
import * as notifications from "../notifications";
import { FakePaymentProvider } from "../payments/fake";
import { setPaymentProvider, type PaymentProvider } from "../payments/provider";
import { getThroneState } from "../throne/state";
import { ADMIN_SESSION_MS, devLoginAllowed } from "./auth";
import { crownWithPayment } from "./test-fixtures";

const BASE = "http://localhost:3000";
let db: Database;

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; host?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { host: init.host ?? "localhost:3000" };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.method && init.method !== "GET") headers.origin = init.origin ?? BASE;
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

async function login(): Promise<string> {
  const res = await devLoginRoute(req("/api/admin/auth/dev-login", { method: "POST" }));
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie")!;
  return setCookie.split(";")[0]; // kti_admin=<token>
}

describe("admin API", () => {
  beforeEach(async () => {
    db = await createTestDb();
    setTestDb(db);
    invalidateConfigCache();
    setNow("2026-03-01T12:00:00Z");
    vi.stubEnv("ADMIN_EMAILS", "admin@localhost, second@localhost");
    vi.stubEnv("ADMIN_DEV_LOGIN", "1");
    vi.stubEnv("ADMIN_BOOTSTRAP_TOKEN", "boot-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    setPaymentProvider(null);
  });
  afterAll(() => {
    setTestDb(null);
    resetClock();
    invalidateConfigCache();
  });

  describe("auth rejection", () => {
    it("every admin route rejects requests without a session (401)", async () => {
      const id = "00000000-0000-4000-8000-000000000000";
      const responses = await Promise.all([
        thronesRoute(req("/api/admin/thrones")),
        bansRoute(req("/api/admin/bans")),
        banRoute(req("/api/admin/bans", { method: "POST", body: { kind: "email", value: "x@y.z" } })),
        removeRoute(req("/api/admin/thrones/eternal/remove", { method: "POST", body: { reasonCategory: "spam" } }), params({ throne: "eternal" })),
        hiddenRoute(req(`/api/admin/reigns/${id}/hidden`, { method: "POST", body: { hidden: true } }), params({ id })),
        refundRoute(req(`/api/admin/payments/${id}/refund`, { method: "POST", body: { confirm: true } }), params({ id })),
        configRoute(req("/api/admin/config", { method: "PATCH", body: { baseCents: 1 } })),
      ]);
      for (const r of responses) {
        expect(r.status).toBe(401);
        expect((await r.json()).error).toBe("unauthorized");
      }
    });

    it("rejects a forged, expired or revoked session", async () => {
      expect((await thronesRoute(req("/api/admin/thrones", { cookie: "kti_admin=forged" }))).status).toBe(401);
      const cookie = await login();
      expect((await thronesRoute(req("/api/admin/thrones", { cookie }))).status).toBe(200);
      vi.stubEnv("ADMIN_EMAILS", "second@localhost"); // admin@localhost removed from the env
      expect((await thronesRoute(req("/api/admin/thrones", { cookie }))).status).toBe(401);
      vi.stubEnv("ADMIN_EMAILS", "admin@localhost");
      advance(ADMIN_SESSION_MS + 1);
      expect((await thronesRoute(req("/api/admin/thrones", { cookie }))).status).toBe(401);
    });

    it("rejects cross-origin mutations even with a session (403)", async () => {
      const cookie = await login();
      const r = await banRoute(req("/api/admin/bans", { method: "POST", cookie, origin: "https://evil.example", body: { kind: "email", value: "a@b.c" } }));
      expect(r.status).toBe(403);
    });

    it("dev login only on localhost, outside production, with ADMIN_DEV_LOGIN=1", async () => {
      expect((await devLoginRoute(req("/api/admin/auth/dev-login", { method: "POST", host: "throne.example", origin: "https://throne.example" }))).status).toBe(404);
      expect(devLoginAllowed("127.0.0.1:3000")).toBe(true);
      expect(devLoginAllowed("[::1]:3000")).toBe(true);
      expect(devLoginAllowed("localhost.evil.com")).toBe(false);
      vi.stubEnv("NODE_ENV", "production");
      expect(devLoginAllowed("localhost:3000")).toBe(false);
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("ADMIN_DEV_LOGIN", "");
      expect((await devLoginRoute(req("/api/admin/auth/dev-login", { method: "POST" }))).status).toBe(404);
    });

    it("first passkey registration requires the bootstrap token and an admin email", async () => {
      const opts = (body: unknown) => registerOptionsRoute(req("/api/admin/auth/register/options", { method: "POST", body }));
      expect((await opts({ email: "intruder@example.com", bootstrapToken: "boot-token" })).status).toBe(403);
      expect((await opts({ email: "admin@localhost", bootstrapToken: "wrong" })).status).toBe(403);
      const ok = await opts({ email: "admin@localhost", bootstrapToken: "boot-token" });
      expect(ok.status).toBe(200);
      expect((await ok.json()).challenge).toEqual(expect.any(String));
      expect(ok.headers.get("set-cookie")).toContain("kti_admin_challenge=");
    });
  });

  describe("actions", () => {
    it("AD-02: removes the current king with a reason category, notifies, audits, keeps the price", async () => {
      const spy = vi.spyOn(notifications, "onKingRemoved").mockResolvedValue();
      const cookie = await login();
      const { reign } = await crownWithPayment("eternal", "Removable", 5_000);
      const res = await removeRoute(
        req("/api/admin/thrones/eternal/remove", { method: "POST", cookie, body: { reignId: reign.id, reasonCategory: "impersonation", notify: true } }),
        params({ throne: "eternal" }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ removedReignId: reign.id });
      const state = await getThroneState("eternal");
      expect(state.king).toBeNull();
      expect(state.minCents).toBe(5_500);
      expect(spy).toHaveBeenCalledWith({ reignId: reign.id, reasonCategory: "impersonation", notify: true });
      const audit = await db.select().from(auditLog).where(eq(auditLog.action, "throne.remove_king"));
      expect(audit[0]).toMatchObject({ actor: "admin@localhost", target: reign.id });
      // removing again → 409
      const again = await removeRoute(
        req("/api/admin/thrones/eternal/remove", { method: "POST", cookie, body: { reignId: reign.id, reasonCategory: "spam" } }),
        params({ throne: "eternal" }),
      );
      expect(again.status).toBe(409);
    });

    it("AD-03: hide and unhide a past reign", async () => {
      const cookie = await login();
      const { reign } = await crownWithPayment("daily", "Past", 200);
      advance(1_000);
      await crownWithPayment("daily", "Now", 220);
      const hide = (hidden: boolean) =>
        hiddenRoute(req(`/api/admin/reigns/${reign.id}/hidden`, { method: "POST", cookie, body: { hidden } }), params({ id: reign.id }));
      expect((await hide(true)).status).toBe(200);
      expect((await getThroneState("daily")).recent.map((r) => r.name)).toEqual(["Now"]);
      expect((await hide(false)).status).toBe(200);
      expect((await getThroneState("daily")).recent.map((r) => r.name)).toEqual(["Now", "Past"]);
    });

    it("AD-04: full refund through the provider removes the current king and requires confirmation", async () => {
      vi.spyOn(notifications, "onRefundIssued").mockResolvedValue();
      const refunds: [string, number | undefined][] = [];
      const provider = Object.assign(new FakePaymentProvider(), {
        refund: async (id: string, amount?: number) => void refunds.push([id, amount]),
      }) as PaymentProvider;
      setPaymentProvider(provider);
      const cookie = await login();
      const { reign, payment } = await crownWithPayment("eternal", "Refundee", 1_500);
      const call = (body: unknown) =>
        refundRoute(req(`/api/admin/payments/${payment.id}/refund`, { method: "POST", cookie, body }), params({ id: payment.id }));

      expect((await call({})).status).toBe(422);
      expect((await call({ confirm: true, amountCents: 99_999 })).status).toBe(422);
      const res = await call({ confirm: true });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ refundedCents: 1_500, removedReignId: reign.id });
      expect(refunds).toEqual([[payment.stripeChargeId, 1_500]]);
      const [p] = await db.select().from(payments).where(eq(payments.id, payment.id));
      expect(p).toMatchObject({ refundedCents: 1_500, status: "refunded" });
      const [r] = await db.select().from(reigns).where(eq(reigns.id, reign.id));
      expect(r.endReason).toBe("refunded");
      expect((await call({ confirm: true })).status).toBe(422); // nothing left to refund
    });

    it("AD-04: a provider failure refunds nothing", async () => {
      setPaymentProvider(Object.assign(new FakePaymentProvider(), { refund: async () => Promise.reject(new Error("boom")) }) as PaymentProvider);
      const cookie = await login();
      const { payment } = await crownWithPayment("eternal", "Safe", 700);
      const res = await refundRoute(
        req(`/api/admin/payments/${payment.id}/refund`, { method: "POST", cookie, body: { confirm: true, amountCents: 100 } }),
        params({ id: payment.id }),
      );
      expect(res.status).toBe(502);
      const [p] = await db.select().from(payments).where(eq(payments.id, payment.id));
      expect(p.refundedCents).toBe(0);
      expect((await getThroneState("eternal")).king?.name).toBe("Safe");
    });

    it("AD-05: bans with expiry are honoured by checkBans and expire", async () => {
      const cookie = await login();
      const ban = (body: unknown) => banRoute(req("/api/admin/bans", { method: "POST", cookie, body }));
      expect((await ban({ kind: "email", value: "Troll@Example.com", reason: "spam", expiresInDays: 1 })).status).toBe(201);
      expect((await ban({ kind: "ip", value: "203.0.113.7" })).status).toBe(201);
      expect((await ban({ kind: "device", value: "dev_abcdefghijklmnop" })).status).toBe(201);
      expect((await ban({ kind: "nope", value: "x" })).status).toBe(422);

      expect(await checkBans({ email: "troll@example.com" })).toMatchObject({ banned: true, reason: "spam" });
      expect(await checkBans({ ipHash: hashIp("203.0.113.7") })).toMatchObject({ banned: true });
      expect(await checkBans({ deviceId: "dev_abcdefghijklmnop" })).toMatchObject({ banned: true });
      expect(await checkBans({ ipHash: hashIp("203.0.113.8") })).toEqual({ banned: false });

      advance(86_400_000 + 1);
      expect(await checkBans({ email: "troll@example.com" })).toEqual({ banned: false });
      const fresh = await login(); // the first session expired after 12 h
      const list = await (await bansRoute(req("/api/admin/bans", { cookie: fresh }))).json();
      expect(list.bans).toHaveLength(2);
    });

    it("AD-07: config update validates, audits and applies", async () => {
      const cookie = await login();
      const patch = (body: unknown) => configRoute(req("/api/admin/config", { method: "PATCH", cookie, body }));
      expect((await patch({ baseCents: -5 })).status).toBe(422);
      expect((await patch({ currency: "CHF" })).status).toBe(422);
      const res = await patch({ baseCents: 300 });
      expect(res.status).toBe(200);
      expect((await res.json()).config.baseCents).toBe(300);
      expect((await getThroneState("eternal")).minCents).toBe(300);
      const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "config.update"));
      expect(a).toMatchObject({ actor: "admin@localhost", before: { baseCents: 200 }, after: { baseCents: 300 } });
    });
  });
});
