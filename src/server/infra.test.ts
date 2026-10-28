import { afterEach, describe, expect, it } from "vitest";
import { listenerCount, publish, subscribe } from "./bus";
import { advance, now, resetClock, setNow } from "./clock";
import { hashBanValue, hashIp, hashToken, signToken, verifyToken } from "./hash";
import { checkOrigin, clientIp, deviceId } from "./http";
import { FakePaymentProvider } from "./payments/fake";
import { getPaymentProvider } from "./payments/provider";

afterEach(() => resetClock());

describe("clock", () => {
  it("setNow / advance / resetClock", () => {
    setNow("2026-01-01T00:00:00Z");
    expect(now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
    advance(1500);
    expect(now().toISOString()).toBe("2026-01-01T00:00:01.500Z");
    resetClock();
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });
});

describe("hash", () => {
  it("salted, namespaced hashes", () => {
    expect(hashIp("1.2.3.4")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp("1.2.3.4")).toBe(hashIp("1.2.3.4"));
    expect(hashIp("1.2.3.4")).not.toBe(hashBanValue("ip", "1.2.3.4"));
    expect(hashBanValue("email", " Max@Example.com ")).toBe(hashBanValue("email", "max@example.com"));
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("signs and verifies expiring tokens bound to a purpose", () => {
    setNow("2026-01-01T00:00:00Z");
    const token = signToken("reclaim", { reignId: "r1" }, 7 * 86_400_000);
    expect(verifyToken<{ reignId: string }>("reclaim", token)?.reignId).toBe("r1");
    expect(verifyToken("unsubscribe", token)).toBeNull();
    expect(verifyToken("reclaim", token.slice(0, -2) + "xx")).toBeNull();
    expect(verifyToken("reclaim", "garbage")).toBeNull();
    advance(7 * 86_400_000);
    expect(verifyToken("reclaim", token)).toBeNull();
  });
});

describe("http", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/x", { method: "POST", headers });

  it("client IP and device id", () => {
    expect(clientIp(req({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIp(req({}))).toBe("0.0.0.0");
    expect(deviceId(req({ cookie: "a=1; kti_device=AbCdEfGhIjKlMnOpQrSt" }))).toBe("AbCdEfGhIjKlMnOpQrSt");
    expect(deviceId(req({ cookie: "kti_device=bad!" }))).toBeNull();
  });

  it("origin check", async () => {
    expect(checkOrigin(req({}))).toBeNull();
    expect(checkOrigin(req({ origin: "http://localhost:3000" }))).toBeNull();
    expect(checkOrigin(req({ origin: "https://throne.example", host: "throne.example" }))).toBeNull();
    const bad = checkOrigin(req({ origin: "https://evil.example", host: "localhost:3000" }));
    expect(bad?.status).toBe(403);
    expect(await bad?.json()).toMatchObject({ error: "forbidden_origin" });
  });
});

describe("bus", () => {
  it("delivers per throne and unsubscribes", () => {
    const got: string[] = [];
    const off = subscribe("daily", (e) => got.push(e.type));
    publish("daily", { type: "presence.count", data: { watching: 2 } });
    publish("eternal", { type: "presence.count", data: { watching: 5 } });
    expect(got).toEqual(["presence.count"]);
    expect(listenerCount("daily")).toBe(1);
    off();
    expect(listenerCount("daily")).toBe(0);
  });
});

describe("fake payments", () => {
  it("is selected without STRIPE_SECRET_KEY", () => {
    expect(getPaymentProvider().mode).toBe("fake");
  });

  it("manual capture lifecycle", async () => {
    const p = new FakePaymentProvider();
    const { id, clientSecret } = await p.createIntent({ amountCents: 242, reservationId: "res1", throne: "eternal" });
    expect(clientSecret.startsWith("fake_")).toBe(true);
    await p.updateAmount(id, 15_000);
    await expect(p.capture(id, "res1")).rejects.toThrow();
    p.authorize(id);
    expect(await p.retrieve(id)).toEqual({ status: "requires_capture", amountCapturable: 15_000 });
    const first = await p.capture(id, "res1");
    expect(await p.capture(id, "res1")).toEqual(first); // idempotent
    await p.refund(id, 5_000);
    await expect(p.refund(id, 20_000)).rejects.toThrow();

    const other = await p.createIntent({ amountCents: 200, reservationId: "res2", throne: "daily" });
    p.authorize(other.id);
    await p.cancel(other.id);
    expect((await p.retrieve(other.id)).status).toBe("canceled");
  });
});
