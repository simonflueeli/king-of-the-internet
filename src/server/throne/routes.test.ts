// C route-level tests: the HTTP contract (ARCHITECTURE "HTTP API"), SSE (AC-19), signed Stripe
// webhooks (AC-10 via HTTP), fake-pay and cron. Handlers are called directly with Request objects.
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateReservationResponse, ThroneEvent } from "@/lib/contracts";
import { GET as cronGET } from "@/app/api/cron/[job]/route";
import { GET as configGET } from "@/app/api/config/public/route";
import { POST as fakePayPOST } from "@/app/api/dev/fake-pay/[id]/route";
import { GET as reignGET } from "@/app/api/reigns/[id]/route";
import { POST as confirmPOST } from "@/app/api/reservations/[id]/confirm/route";
import { POST as heartbeatPOST } from "@/app/api/reservations/[id]/heartbeat/route";
import { DELETE as reservationDELETE, GET as reservationGET } from "@/app/api/reservations/[id]/route";
import { GET as eventsGET } from "@/app/api/thrones/[throne]/events/route";
import { GET as reignsGET } from "@/app/api/thrones/[throne]/reigns/route";
import { POST as reservePOST } from "@/app/api/thrones/[throne]/reservations/route";
import { GET as throneGET } from "@/app/api/thrones/[throne]/route";
import { POST as webhookPOST } from "@/app/api/webhooks/stripe/route";
import { moderationChecks, payments, reigns } from "../db/schema";
import { setPolicyClassifier } from "../moderation";
import { watchingCount } from "./presence";
import { confirmBody, count, setupKit, teardownKit, type Kit } from "./testkit";

const mocks = vi.hoisted(() => ({ onTakeoverCommitted: vi.fn(async () => {}) }));
vi.mock("../notifications", () => ({
  onTakeoverCommitted: mocks.onTakeoverCommitted,
  onKingRemoved: async () => {},
  onRefundIssued: async () => {},
}));

const BASE = "http://localhost:3000";
let kit: Kit;
let ipN = 0;

// Real moderation (S) with a fake policy classifier that allows everything, so these tests run the
// regex / banned-terms rules and the moderation_checks log without an LLM.
const allowAll = { model: "fake-allow", classify: async () => ({ decision: "allow" as const }) };

beforeEach(async () => {
  kit = await setupKit();
  setPolicyClassifier(allowAll);
  mocks.onTakeoverCommitted.mockClear();
});
afterEach(() => {
  setPolicyClassifier(null);
  teardownKit();
});

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

function post(path: string, body?: unknown, headers: Record<string, string> = {}) {
  ipN += 1;
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `10.0.0.${ipN}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function reserve(throne: "eternal" | "daily" = "eternal") {
  const res = await reservePOST(post(`/api/thrones/${throne}/reservations`, { source: "tryon" }), params({ throne }));
  return { res, body: (await res.json()) as CreateReservationResponse & { error?: string; lockedUntil?: string } };
}

async function takeOver(name: string, amountCents?: number) {
  const { body: r } = await reserve();
  const tok = { "x-reservation-token": r.reservationToken };
  const c = await confirmPOST(post(`/api/reservations/${r.reservationId}/confirm`, confirmBody(amountCents ?? r.minCents, name), tok), params({ id: r.reservationId }));
  expect(c.status).toBe(200);
  const p = await fakePayPOST(post(`/api/dev/fake-pay/${r.reservationId}`, { outcome: "succeed" }, tok), params({ id: r.reservationId }));
  expect(p.status).toBe(200);
  return { r, status: await p.json() };
}

/** Minimal SSE reader over a Response body. */
function sseReader(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: ThroneEvent[] = [];
  let pings = 0;
  async function next(pred: (e: ThroneEvent) => boolean, timeoutMs = 3_000): Promise<ThroneEvent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = events.findIndex(pred);
      if (i >= 0) return events.splice(i, 1)[0];
      if (Date.now() > deadline) throw new Error(`no matching SSE event; saw ${events.map((e) => e.type).join(",")}`);
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), 200)),
      ]);
      if (chunk.value) buf += decoder.decode(chunk.value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        if (block.startsWith(": ping")) pings += 1;
        const type = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (type && data) events.push({ type, data: JSON.parse(data) } as ThroneEvent);
      }
    }
  }
  return { next, events, pings: () => pings };
}

describe("HTTP flow (fake mode)", () => {
  it("reserve → confirm → fake-pay succeed → GET throne shows the new king; second reservation gets 409", async () => {
    const { res, body: r } = await reserve();
    expect(res.status).toBe(201);
    expect(r).toMatchObject({ minCents: 200, paymentMode: "fake" });
    expect(r.clientSecret.startsWith("fake_")).toBe(true);

    const busy = await reserve();
    expect(busy.res.status).toBe(409);
    expect(busy.body).toMatchObject({ error: "busy", lockedUntil: r.expiresAt });

    const tok = { "x-reservation-token": r.reservationToken };
    const hb = await heartbeatPOST(post(`/api/reservations/${r.reservationId}/heartbeat`, undefined, tok), params({ id: r.reservationId }));
    expect(hb.status).toBe(200);
    expect((await heartbeatPOST(post(`/api/reservations/${r.reservationId}/heartbeat`), params({ id: r.reservationId }))).status).toBe(401);

    const bad = await confirmPOST(post(`/api/reservations/${r.reservationId}/confirm`, confirmBody(199, "Max"), tok), params({ id: r.reservationId }));
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: "amount", minCents: 200, message: "Enter a price between €2.00 and €1,000,000." });

    // S's real rules run: a link in the name is rejected with a category, and every check is logged.
    const link = await confirmPOST(post(`/api/reservations/${r.reservationId}/confirm`, confirmBody(15_000, "visit spam.example.com", { email: "max@example.com" }), tok), params({ id: r.reservationId }));
    expect(link.status).toBe(422);
    expect(await link.json()).toMatchObject({ error: "moderation", field: "name", category: "links" });

    const c = await confirmPOST(post(`/api/reservations/${r.reservationId}/confirm`, confirmBody(15_000, "Max"), tok), params({ id: r.reservationId }));
    expect(c.status).toBe(200);
    expect(await c.json()).toMatchObject({ state: "paying", amountCents: 15_000 });

    expect((await kit.db.select().from(moderationChecks)).map((m) => [m.field, m.result, m.model])).toEqual([
      ["name", "deny", "none"],
      ["proclamation", "allow", "none"],
      ["name", "allow", "fake-allow"],
      ["proclamation", "allow", "fake-allow"],
    ]);

    const p = await fakePayPOST(post(`/api/dev/fake-pay/${r.reservationId}`, { outcome: "succeed" }, tok), params({ id: r.reservationId }));
    const status = await p.json();
    expect(status).toMatchObject({ state: "completed", failReason: null });

    const state = await (await throneGET(new Request(`${BASE}/api/thrones/eternal`), params({ throne: "eternal" }))).json();
    expect(state.king).toMatchObject({ name: "Max", title: "Duke", paidCents: 15_000 });
    expect(state.minCents).toBe(16_500);
    expect(state.reservation).toBeNull();

    const reign = await (await reignGET(new Request(`${BASE}/api/reigns/${status.reignId}`), params({ id: status.reignId }))).json();
    expect(reign).toMatchObject({ name: "Max", hidden: false });
    expect((await reignGET(new Request(`${BASE}/api/reigns/nope`), params({ id: "nope" }))).status).toBe(404);

    const polled = await (await reservationGET(new Request(`${BASE}/api/reservations/${r.reservationId}`), params({ id: r.reservationId }))).json();
    expect(polled.state).toBe("completed");

    const history = await (await reignsGET(new Request(`${BASE}/api/thrones/eternal/reigns`), params({ throne: "eternal" }))).json();
    expect(history).toMatchObject({ reigns: [{ name: "Max" }], nextCursor: null });
  });

  it("DELETE releases at once; unknown throne 404; foreign Origin 403; decline keeps paying", async () => {
    const { body: r } = await reserve();
    const tok = { "x-reservation-token": r.reservationToken };
    const del = await reservationDELETE(
      new Request(`${BASE}/api/reservations/${r.reservationId}`, { method: "DELETE", headers: { origin: BASE, ...tok } }),
      params({ id: r.reservationId }),
    );
    expect(del.status).toBe(204);
    expect((await reserve()).res.status).toBe(201);

    expect((await throneGET(new Request(`${BASE}/api/thrones/weekly`), params({ throne: "weekly" }))).status).toBe(404);
    const evil = await reservePOST(post("/api/thrones/daily/reservations", {}, { origin: "https://evil.example" }), params({ throne: "daily" }));
    expect(evil.status).toBe(403);

    const { body: d } = await reserve("daily");
    const dt = { "x-reservation-token": d.reservationToken };
    await confirmPOST(post(`/api/reservations/${d.reservationId}/confirm`, confirmBody(200, "Dee"), dt), params({ id: d.reservationId }));
    const declined = await (await fakePayPOST(post(`/api/dev/fake-pay/${d.reservationId}`, { outcome: "decline" }, dt), params({ id: d.reservationId }))).json();
    expect(declined).toMatchObject({ state: "paying", failReason: "card_declined" });

    // U.md 1: Pay again after a decline → confirm is accepted while paying (new amount, lock kept).
    const again = await confirmPOST(post(`/api/reservations/${d.reservationId}/confirm`, confirmBody(250, "Dee"), dt), params({ id: d.reservationId }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ state: "paying", amountCents: 250, failReason: null });
    expect(kit.pay.forReservation(d.reservationId)!.amountCents).toBe(250);
    // U.md 7: GET and DELETE carry X-Reservation-Token.
    const got = await reservationGET(new Request(`${BASE}/api/reservations/${d.reservationId}`, { headers: dt }), params({ id: d.reservationId }));
    expect(got.status).toBe(200);
    // U.md 3: DELETE releases a paying reservation that has nothing authorized.
    const cancel = await reservationDELETE(
      new Request(`${BASE}/api/reservations/${d.reservationId}`, { method: "DELETE", headers: { origin: BASE, ...dt } }),
      params({ id: d.reservationId }),
    );
    expect(cancel.status).toBe(204);
    expect(await (await reservationGET(new Request(`${BASE}/api/reservations/${d.reservationId}`), params({ id: d.reservationId }))).json()).toMatchObject({ state: "released" });
    expect(kit.pay.forReservation(d.reservationId)!.status).toBe("canceled");
    expect((await reserve("daily")).res.status).toBe(201);
  });

  it("DELETE after the card is authorized → 409 payment_in_progress; the takeover still completes", async () => {
    const { body: r } = await reserve();
    const tok = { "x-reservation-token": r.reservationToken };
    await confirmPOST(post(`/api/reservations/${r.reservationId}/confirm`, confirmBody(200, "Committed"), tok), params({ id: r.reservationId }));
    const intent = kit.pay.forReservation(r.reservationId)!;
    kit.pay.authorize(intent.id);
    const del = await reservationDELETE(
      new Request(`${BASE}/api/reservations/${r.reservationId}`, { method: "DELETE", headers: { origin: BASE, ...tok } }),
      params({ id: r.reservationId }),
    );
    expect(del.status).toBe(409);
    expect(await del.json()).toMatchObject({ error: "payment_in_progress" });
    const { handleAuthorized } = await import("./crown");
    expect((await handleAuthorized(intent.id)).outcome).toBe("crowned");
  });

  it("GET /api/config/public", async () => {
    const cfg = await (await configGET(new Request(`${BASE}/api/config/public`))).json();
    expect(cfg).toEqual({
      currency: "EUR",
      baseCents: 200,
      stepBps: 1000,
      decayBps: 200,
      maxCents: 100_000_000,
      nameMax: 24,
      proclamationMax: 140,
      reservationMs: 180_000,
      heartbeatMs: 20_000,
      paymentMode: "fake",
      stripePublishableKey: null,
    });
  });
});

describe("SSE", () => {
  it("AC-19: two viewers; one takes over → the other gets throne.updated with the new king; private result only to the buyer", async () => {
    const viewerAbort = new AbortController();
    const viewer = sseReader(await eventsGET(new Request(`${BASE}/api/thrones/eternal/events`, { signal: viewerAbort.signal }), params({ throne: "eternal" })));
    const first = await viewer.next(() => true);
    expect(first.type).toBe("throne.updated");
    expect(first.type === "throne.updated" && first.data.king).toBeNull();
    expect(watchingCount("eternal")).toBe(1);

    const { body: r } = await reserve();
    const buyerAbort = new AbortController();
    const buyer = sseReader(
      await eventsGET(
        new Request(`${BASE}/api/thrones/eternal/events?reservationId=${r.reservationId}&token=${r.reservationToken}`, { signal: buyerAbort.signal }),
        params({ throne: "eternal" }),
      ),
    );
    expect((await buyer.next(() => true)).type).toBe("throne.updated");
    expect(watchingCount("eternal")).toBe(2);

    const tok = { "x-reservation-token": r.reservationToken };
    await confirmPOST(post(`/api/reservations/${r.reservationId}/confirm`, confirmBody(1_500, "Live King"), tok), params({ id: r.reservationId }));
    const t0 = Date.now();
    await fakePayPOST(post(`/api/dev/fake-pay/${r.reservationId}`, { outcome: "succeed" }, tok), params({ id: r.reservationId }));

    const update = await viewer.next((e) => e.type === "throne.updated" && e.data.king?.name === "Live King");
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(update.type === "throne.updated" && update.data.king).toMatchObject({ title: "Baron", paidCents: 1_500 });

    const result = await buyer.next((e) => e.type === "reservation.result");
    expect(result.data).toMatchObject({ reservationId: r.reservationId, state: "completed" });
    expect(viewer.events.some((e) => e.type === "reservation.result")).toBe(false);
    const lockUpdates = viewer.events.filter((e) => e.type === "reservation.updated").map((e) => e.data.state);
    expect(lockUpdates).toEqual(["active", "paying", null]); // public lock state, no buyer data

    viewerAbort.abort();
    buyerAbort.abort();
    expect(watchingCount("eternal")).toBe(0);
  });

  it("a reconnecting buyer gets its finished result right after the first throne.updated; pings flow", async () => {
    const { r } = await takeOver("Quick");
    const ac = new AbortController();
    const { openThroneStream } = await import("./sse");
    const { verifyReservationToken } = await import("./reservations");
    const reservation = await verifyReservationToken(r.reservationId, r.reservationToken);
    const stream = sseReader(new Response(openThroneStream("eternal", { signal: ac.signal, reservation, pingMs: 50 })));
    const e1 = await stream.next(() => true);
    expect(e1.type).toBe("throne.updated");
    const e2 = await stream.next(() => true);
    expect(e2).toMatchObject({ type: "reservation.result", data: { state: "completed" } });
    await new Promise((res) => setTimeout(res, 120));
    await stream.next(() => false, 300).catch(() => null);
    expect(stream.pings()).toBeGreaterThan(0);
    ac.abort();
  });
});

describe("Stripe webhook route", () => {
  const secret = "whsec_test_secret";
  beforeEach(() => vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret));
  afterEach(() => vi.unstubAllEnvs());

  function signed(event: object) {
    const payload = JSON.stringify(event);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    return new Request(`${BASE}/api/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": header }, body: payload });
  }

  it("AC-10 via HTTP: the same event delivered twice → one capture, one reign, one receipt; bad signature → 400", async () => {
    const { body: r } = await reserve();
    const tok = { "x-reservation-token": r.reservationToken };
    await confirmPOST(post(`/api/reservations/${r.reservationId}/confirm`, confirmBody(300, "Hooked"), tok), params({ id: r.reservationId }));
    const intent = kit.pay.forReservation(r.reservationId)!;
    kit.pay.authorize(intent.id);
    const event = {
      id: "evt_test_1",
      object: "event",
      type: "payment_intent.amount_capturable_updated",
      data: { object: { id: intent.id, object: "payment_intent", amount_capturable: 300 } },
    };
    const a = await webhookPOST(signed(event));
    expect(a.status).toBe(200);
    expect(await a.json()).toMatchObject({ duplicate: false, handled: true });
    const b = await webhookPOST(signed(event));
    expect(await b.json()).toMatchObject({ duplicate: true });
    // A different event for the same intent (payment_intent.succeeded) is a no-op by reservation state.
    expect((await webhookPOST(signed({ ...event, id: "evt_test_2", type: "payment_intent.succeeded" }))).status).toBe(200);

    expect(await count(kit.db, reigns)).toBe(1);
    expect(await count(kit.db, payments)).toBe(1);
    expect(intent.captureKeys.size).toBe(1);
    await vi.waitFor(() => expect(mocks.onTakeoverCommitted).toHaveBeenCalledTimes(1));

    const forged = new Request(`${BASE}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
      body: JSON.stringify(event),
    });
    expect((await webhookPOST(forged)).status).toBe(400);
  });
});

describe("cron route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires the bearer secret and runs the named job", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const call = (job: string, auth?: string) =>
      cronGET(new Request(`${BASE}/api/cron/${job}`, { headers: auth ? { authorization: auth } : {} }), params({ job }));
    expect((await call("expire")).status).toBe(401);
    expect((await call("expire", "Bearer wrong")).status).toBe(401);
    expect((await call("nope", "Bearer s3cret")).status).toBe(404);
    for (const job of ["expire", "reconcile", "daily-reset", "retention"]) {
      const res = await call(job, "Bearer s3cret");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true });
    }
  });
});
