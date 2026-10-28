// OWNER: F. The server's notion of "now". All server code must use now() instead of new Date() /
// Date.now() for anything that affects prices, reservations, reigns or token expiry, so tests can
// drive time with setNow() / advance().

type ClockState = { fixedMs: number | null };
const g = globalThis as unknown as { __ktiClock?: ClockState };
const state: ClockState = (g.__ktiClock ??= { fixedMs: null });

export function now(): Date {
  return new Date(state.fixedMs ?? Date.now());
}

export function nowMs(): number {
  return state.fixedMs ?? Date.now();
}

/** Freeze the clock at `t` (tests). */
export function setNow(t: Date | string | number): void {
  state.fixedMs = new Date(t).getTime();
}

/** Move the clock forward by `ms`; freezes it at the current time first if it was running. */
export function advance(ms: number): void {
  state.fixedMs = (state.fixedMs ?? Date.now()) + ms;
}

/** Back to real time. */
export function resetClock(): void {
  state.fixedMs = null;
}
