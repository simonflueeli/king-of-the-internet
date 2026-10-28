// OWNER: C. Presence = number of open SSE connections per throne (PRD FR-30). Changes are
// broadcast as `presence.count` at most once every 2 s per throne (trailing edge, so the last
// value always goes out). In-process like the bus; a Redis-backed version would keep the same API.
import type { ThroneId } from "@/lib/contracts";
import { publish } from "../bus";

export const PRESENCE_THROTTLE_MS = 2_000;

interface PresenceState {
  counts: Map<ThroneId, number>;
  lastSentAt: Map<ThroneId, number>;
  lastSentValue: Map<ThroneId, number>;
  timers: Map<ThroneId, ReturnType<typeof setTimeout>>;
}

const g = globalThis as unknown as { __ktiPresence?: PresenceState };
const state: PresenceState = (g.__ktiPresence ??= {
  counts: new Map(),
  lastSentAt: new Map(),
  lastSentValue: new Map(),
  timers: new Map(),
});

export function watchingCount(throne: ThroneId): number {
  return state.counts.get(throne) ?? 0;
}

/** Register one viewer connection. Returns the release function (idempotent). */
export function joinPresence(throne: ThroneId): () => void {
  state.counts.set(throne, watchingCount(throne) + 1);
  schedule(throne);
  let left = false;
  return () => {
    if (left) return;
    left = true;
    state.counts.set(throne, Math.max(0, watchingCount(throne) - 1));
    schedule(throne);
  };
}

// Throttling uses real time on purpose: it is about network chatter, not business time.
function schedule(throne: ThroneId): void {
  if (state.timers.has(throne)) return; // a trailing send is already pending
  const wait = (state.lastSentAt.get(throne) ?? 0) + PRESENCE_THROTTLE_MS - Date.now();
  if (wait <= 0) {
    send(throne);
    return;
  }
  const timer = setTimeout(() => {
    state.timers.delete(throne);
    send(throne);
  }, wait);
  timer.unref?.();
  state.timers.set(throne, timer);
}

function send(throne: ThroneId): void {
  const watching = watchingCount(throne);
  if (state.lastSentValue.get(throne) === watching) return;
  state.lastSentAt.set(throne, Date.now());
  state.lastSentValue.set(throne, watching);
  publish(throne, { type: "presence.count", data: { watching } });
}

/** Tests: forget all presence state. */
export function resetPresence(): void {
  for (const t of state.timers.values()) clearTimeout(t);
  state.counts.clear();
  state.lastSentAt.clear();
  state.lastSentValue.clear();
  state.timers.clear();
}
