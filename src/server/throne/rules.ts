// OWNER: C. Pure reservation timing rules (PRD "Checkout and payment" → Flow), shared by the
// reservation service, the crown path, the jobs and the throne state.
import type { ReservationState } from "@/lib/contracts";
import type { AppConfig } from "../config";

export interface ReservationTiming {
  state: ReservationState;
  expiresAt: Date;
  lastHeartbeatAt: Date;
}

export const OPEN_STATES = ["active", "paying"] as const satisfies readonly ReservationState[];

export function isOpenState(state: ReservationState): state is (typeof OPEN_STATES)[number] {
  return state === "active" || state === "paying";
}

/**
 * Why an open reservation is no longer valid at `now`, or null while it still holds the lock.
 * - past expires_at → "expired" (applies to active and paying)
 * - active and silent for longer than the heartbeat timeout → "released"
 *   (once payment has started the heartbeat no longer matters)
 */
export function deadReason(
  r: ReservationTiming,
  cfg: Pick<AppConfig, "heartbeatTimeoutMs">,
  now: Date,
): "expired" | "released" | null {
  if (!isOpenState(r.state)) return null;
  if (r.expiresAt.getTime() <= now.getTime()) return "expired";
  if (r.state === "active" && r.lastHeartbeatAt.getTime() + cfg.heartbeatTimeoutMs <= now.getTime()) return "released";
  return null;
}

export function isLive(r: ReservationTiming, cfg: Pick<AppConfig, "heartbeatTimeoutMs">, now: Date): boolean {
  return isOpenState(r.state) && deadReason(r, cfg, now) === null;
}

/** Confirm extends the lock to now + payingExtensionMs, never past createdAt + reservationMaxLifeMs. */
export function payingExpiry(
  createdAt: Date,
  now: Date,
  cfg: Pick<AppConfig, "payingExtensionMs" | "reservationMaxLifeMs">,
): Date {
  return new Date(Math.min(now.getTime() + cfg.payingExtensionMs, createdAt.getTime() + cfg.reservationMaxLifeMs));
}
