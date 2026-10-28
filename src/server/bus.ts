// OWNER: F. In-process pub/sub for throne events (feeds SSE). Single instance for now; the
// interface is small enough to back with Redis pub/sub later.
//
// Every event for a throne goes to every subscriber of that throne, including the private
// `reservation.result`: the SSE route forwards that one only to the connection that proved it owns
// the reservation (matching reservationId + token).
import type { ThroneEvent, ThroneId } from "@/lib/contracts";

export type BusListener = (event: ThroneEvent) => void;

type BusState = Map<ThroneId, Set<BusListener>>;
const g = globalThis as unknown as { __ktiBus?: BusState };
const channels: BusState = (g.__ktiBus ??= new Map());

export function publish(throne: ThroneId, event: ThroneEvent): void {
  const listeners = channels.get(throne);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (err) {
      console.error("[bus] listener failed", { throne, type: event.type, err });
    }
  }
}

/** Returns an unsubscribe function. */
export function subscribe(throne: ThroneId, listener: BusListener): () => void {
  let listeners = channels.get(throne);
  if (!listeners) channels.set(throne, (listeners = new Set()));
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listenerCount(throne: ThroneId): number {
  return channels.get(throne)?.size ?? 0;
}
