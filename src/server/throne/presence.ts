// OWNER: C. Presence = number of open SSE connections per throne (PRD FR-30). Changes are
// broadcast as `presence.count` at most once every 2 s per throne (trailing edge, so the last
// value always goes out). In-process like the bus; a Redis-backed version would keep the same API.
//
// The count is the size of a registry of live connections, never a bare counter, so it cannot drift:
// - a connection is released on abort, on stream cancel and on a failed write (sse.ts);
// - a periodic sweep asks every connection whether it is still alive and drops the ones that are not
//   (e.g. a response that ended without the abort / cancel ever reaching us), so a dead connection
//   can never stay counted for more than a few sweeps.
import type { ThroneId } from "@/lib/contracts";
import { publish } from "../bus";

export const PRESENCE_THROTTLE_MS = 2_000;
export const PRESENCE_SWEEP_MS = 15_000;

export interface PresenceConnection {
  /** False once the connection is known to be dead (closed, cancelled, or its reader stopped). */
  isAlive(): boolean;
  /** Tear the connection down (unsubscribe, stop timers); should call the release function. */
  close(): void;
}

interface Entry {
  throne: ThroneId;
  conn: PresenceConnection;
}

interface PresenceState {
  nextId: number;
  connections: Map<number, Entry>;
  lastSentAt: Map<ThroneId, number>;
  lastSentValue: Map<ThroneId, number>;
  timers: Map<ThroneId, ReturnType<typeof setTimeout>>;
  sweeper: ReturnType<typeof setInterval> | null;
}

// Versioned key: a dev server that hot-reloads this module must not reuse an older state shape.
const g = globalThis as unknown as { __ktiPresenceV2?: PresenceState };
const state: PresenceState = (g.__ktiPresenceV2 ??= {
  nextId: 1,
  connections: new Map(),
  lastSentAt: new Map(),
  lastSentValue: new Map(),
  timers: new Map(),
  sweeper: null,
});

export function watchingCount(throne: ThroneId): number {
  let n = 0;
  for (const e of state.connections.values()) if (e.throne === throne) n++;
  return n;
}

/** Register one viewer connection. Returns the release function (idempotent). */
export function registerConnection(throne: ThroneId, conn: PresenceConnection): () => void {
  const id = state.nextId++;
  state.connections.set(id, { throne, conn });
  ensureSweeper();
  schedule(throne);
  return () => {
    if (!state.connections.delete(id)) return;
    schedule(throne);
  };
}

/** Drop every connection that reports itself dead. Runs on a timer; exported for tests. */
export function sweepPresence(): number {
  let dropped = 0;
  for (const [id, e] of [...state.connections]) {
    let alive = false;
    try {
      alive = e.conn.isAlive();
    } catch {
      alive = false;
    }
    if (alive) continue;
    dropped++;
    try {
      e.conn.close();
    } catch (err) {
      console.error("[presence] close failed", err);
    }
    if (state.connections.delete(id)) schedule(e.throne); // in case close() did not release
  }
  if (dropped) console.warn("[presence] swept dead connections", { dropped });
  if (!state.connections.size && state.sweeper) {
    clearInterval(state.sweeper);
    state.sweeper = null;
  }
  return dropped;
}

function ensureSweeper(): void {
  if (state.sweeper) return;
  state.sweeper = setInterval(sweepPresence, PRESENCE_SWEEP_MS);
  state.sweeper.unref?.();
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
  if (state.sweeper) clearInterval(state.sweeper);
  state.sweeper = null;
  state.connections.clear();
  state.lastSentAt.clear();
  state.lastSentValue.clear();
  state.timers.clear();
}
