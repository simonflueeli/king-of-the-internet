// Presence = number of open SSE streams per throne, released on abort, cancel, failed write, and by
// the sweep when a stream's reader is gone. Plain and reservation streams each count once.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as eventsGET } from "@/app/api/thrones/[throne]/events/route";
import { listenerCount } from "../bus";
import { setPolicyClassifier } from "../moderation";
import { registerConnection, sweepPresence, watchingCount } from "./presence";
import { createReservation } from "./reservations";
import { openThroneStream } from "./sse";
import { setupKit, someone, teardownKit } from "./testkit";
import { getThroneState } from "./state";

beforeEach(async () => {
  await setupKit();
  setPolicyClassifier({ model: "fake-allow", classify: async () => ({ decision: "allow" }) });
});
afterEach(() => {
  setPolicyClassifier(null);
  teardownKit();
});

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/** Open a stream through the route handler and read its first event, like a browser tab would. */
async function openTab(throne: "eternal" | "daily", query = "") {
  const ac = new AbortController();
  const res = await eventsGET(
    new Request(`http://localhost:3000/api/thrones/${throne}/events${query}`, { signal: ac.signal }),
    { params: Promise.resolve({ throne }) },
  );
  const reader = res.body!.getReader();
  await reader.read(); // "retry: 3000" (+ first throne.updated)
  return { ac, reader };
}

describe("presence", () => {
  it("counts open streams per throne; abort and cancel release them; reservation streams count once", async () => {
    const a = await openTab("eternal");
    const b = await openTab("eternal");
    const d = await openTab("daily");
    expect(watchingCount("eternal")).toBe(2);
    expect(watchingCount("daily")).toBe(1);
    expect((await getThroneState("eternal")).watching).toBe(2);

    // The checkout switches a tab from the plain stream to the reservation stream.
    const r = await createReservation("eternal", someone());
    a.ac.abort();
    const withReservation = await openTab("eternal", `?reservationId=${r.reservationId}&token=${r.reservationToken}`);
    expect(watchingCount("eternal")).toBe(2);
    // A bad token still gets the public stream and still counts exactly once.
    const badToken = await openTab("eternal", `?reservationId=${r.reservationId}&token=nope`);
    expect(watchingCount("eternal")).toBe(3);

    await badToken.reader.cancel(); // stream cancel (client went away, body cancelled)
    expect(watchingCount("eternal")).toBe(2);
    withReservation.ac.abort(); // request abort
    b.ac.abort();
    expect(watchingCount("eternal")).toBe(0);
    expect(watchingCount("daily")).toBe(1);
    d.ac.abort();
    expect(watchingCount("daily")).toBe(0);
    expect(listenerCount("eternal") + listenerCount("daily")).toBe(0);
    expect(sweepPresence()).toBe(0); // nothing left over for the sweep
  });

  it("aborting twice or cancelling after abort never double-decrements", async () => {
    const a = await openTab("eternal");
    const b = await openTab("eternal");
    a.ac.abort();
    a.ac.abort();
    await a.reader.cancel().catch(() => {});
    expect(watchingCount("eternal")).toBe(1);
    b.ac.abort();
    expect(watchingCount("eternal")).toBe(0);
  });

  it("the sweep drops a stream nobody reads any more (response ended without abort or cancel)", async () => {
    const live = new AbortController();
    const dead = new AbortController();
    const liveStream = openThroneStream("eternal", { signal: live.signal, pingMs: 5 });
    const deadStream = openThroneStream("eternal", { signal: dead.signal, pingMs: 5 });
    const liveReader = liveStream.getReader();
    const deadReader = deadStream.getReader();
    await deadReader.read(); // read once, then never again
    let reading = true;
    const drain = (async () => {
      while (reading) {
        const { done } = await liveReader.read();
        if (done) break;
      }
    })();
    await tick(40);
    expect(watchingCount("eternal")).toBe(2);

    // Pings pile up unread on the dead stream; after STALE_SWEEPS sweeps it no longer counts.
    expect(sweepPresence()).toBe(0); // first sweep with a backlog: suspicious, still counted
    expect(watchingCount("eternal")).toBe(2);
    await tick(40);
    expect(sweepPresence()).toBe(1); // second one in a row: dropped; the live reader is kept
    expect(watchingCount("eternal")).toBe(1);
    expect(listenerCount("eternal")).toBe(1); // its bus subscription is gone too

    reading = false;
    live.abort();
    await drain;
    expect(watchingCount("eternal")).toBe(0);
    dead.abort(); // late abort of an already swept stream is harmless
    expect(watchingCount("eternal")).toBe(0);
  });

  it("the sweep also drops a connection whose close() forgot to release", () => {
    let alive = true;
    registerConnection("daily", { isAlive: () => alive, close: () => {} });
    expect(watchingCount("daily")).toBe(1);
    expect(sweepPresence()).toBe(0);
    alive = false;
    expect(sweepPresence()).toBe(1);
    expect(watchingCount("daily")).toBe(0);
  });
});
