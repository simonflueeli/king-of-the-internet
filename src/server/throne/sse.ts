// OWNER: C. Server-Sent Events stream for one throne (GET /api/thrones/{throne}/events).
// - first event is always `throne.updated` (events published meanwhile are queued behind it)
// - `: ping` comment every 15 s keeps proxies from closing the connection
// - `reservation.result` is forwarded only when the connection proved it owns that reservation
// - each open stream counts as one viewer (presence); everything is released on abort, on cancel, on
//   a failed write, or when the presence sweep finds that nobody reads the stream any more
import type { ThroneEvent, ThroneId } from "@/lib/contracts";
import { subscribe } from "../bus";
import { toReservationStatus, type ReservationRow } from "./common";
import { registerConnection } from "./presence";
import { isOpenState } from "./rules";
import { getThroneState } from "./state";

export const SSE_PING_MS = 15_000;
/** Sweeps in a row with unread data before a stream stops counting as a viewer. */
export const STALE_SWEEPS = 2;

export const SSE_HEADERS: HeadersInit = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-store, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no", // nginx: do not buffer the stream
};

export function formatSse(event: ThroneEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export function openThroneStream(
  throne: ThroneId,
  opts: { signal?: AbortSignal; reservation?: ReservationRow | null; pingMs?: number },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const ownReservationId = opts.reservation?.id ?? null;
  let cleanup = () => {};

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let ready = false;
      const queued: ThroneEvent[] = [];

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (event: ThroneEvent) => {
        if (event.type === "reservation.result" && event.data.reservationId !== ownReservationId) return;
        if (!ready) queued.push(event);
        else write(formatSse(event));
      };

      const unsubscribe = subscribe(throne, send);
      // Presence sweep: a live reader drains the queue between sweeps; a backlog that persists over
      // STALE_SWEEPS consecutive sweeps means nobody reads this response any more (it ended without
      // an abort or cancel reaching us), so it stops counting as a viewer.
      let staleSweeps = 0;
      const leave = registerConnection(throne, {
        isAlive: () => {
          if (closed) return false;
          const desired = controller.desiredSize;
          if (desired === null) return false; // errored
          staleSweeps = desired < 0 ? staleSweeps + 1 : 0;
          return staleSweeps < STALE_SWEEPS;
        },
        close: () => cleanup(),
      });
      const ping = setInterval(() => write(": ping\n\n"), opts.pingMs ?? SSE_PING_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        leave();
        opts.signal?.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // already closed / errored
        }
      };
      if (opts.signal?.aborted) return cleanup();
      opts.signal?.addEventListener("abort", cleanup);

      write("retry: 3000\n\n");
      try {
        write(formatSse({ type: "throne.updated", data: await getThroneState(throne) }));
      } catch (err) {
        console.error("[sse] initial state failed", { throne, err });
        return cleanup();
      }
      // Already finished before this connection opened (e.g. the tab reconnected): tell it now.
      const r = opts.reservation;
      if (r && !isOpenState(r.state)) {
        const s = toReservationStatus(r);
        write(formatSse({
          type: "reservation.result",
          data: { reservationId: s.id, state: s.state, failReason: s.failReason, reignId: s.reignId },
        }));
      }
      ready = true;
      for (const e of queued.splice(0)) write(formatSse(e));
    },
    cancel() {
      cleanup();
    },
  });
}
