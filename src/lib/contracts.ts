// OWNER: F. Shared DTOs — frozen. Changes go through docs/changes/<workstream>.md.
// Must stay identical to docs/ARCHITECTURE.md "Shared types".

export type ThroneId = "eternal" | "daily";
export type Title = "Lord" | "Baron" | "Duke" | "Archduke" | "Emperor";
export type EndReason = "takeover" | "removed" | "reset" | "refunded" | "disputed";
export type ReservationState = "active" | "paying" | "completed" | "expired" | "released" | "failed";
export type FailReason =
  | "expired" | "released" | "card_declined" | "outbid"     // outbid = authorized but reservation/throne no longer valid
  | "capture_failed" | "canceled" | "moderation" | "banned";
export type PaymentMode = "stripe" | "fake";

export interface ReignDTO {
  id: string;
  throne: ThroneId;
  name: string;
  proclamation: string | null;      // null when empty
  proclamationBlurred: boolean;     // 3+ reports pending (PRD "Reports")
  paidCents: number;
  title: Title;
  startedAt: string;                // ISO
  endedAt: string | null;
  endReason: EndReason | null;
  lengthMs: number;                 // computed with server now for ongoing reigns
}

export interface ThroneState {
  throne: ThroneId;
  serverNow: string;                // ISO, client uses it to correct clock skew
  version: number;
  king: (ReignDTO & { crownedAt: string }) | null;   // null when vacant
  vacancy: null | { reason: "never" | "removed" | "reset"; yesterdayRuler: string | null };
  minCents: number;                 // current minimum (decay / daily reset applied)
  nextMinCentsAtMinimum: number;    // what the next challenger pays if this buyer pays minCents
  idleDays: number;                 // eternal: full idle days (decay info); daily: 0
  resetsAt: string | null;          // daily: next 00:00 UTC; eternal: null
  reservation: { lockedUntil: string } | null;  // another buyer in checkout (no buyer data)
  stats: {
    reignCount: number;             // eternal: all-time; daily: today
    totalPaidCents: number;
    longest: ReignDTO | null;
    highest: ReignDTO | null;
  };
  recent: ReignDTO[];               // last 12, newest first, hidden reigns excluded
  lastTakeoverAt: string | null;
  watching: number;
}

export interface PublicConfig {
  currency: "EUR";
  baseCents: number; stepBps: number; decayBps: number; maxCents: number;
  nameMax: number; proclamationMax: number;
  reservationMs: number; heartbeatMs: number;
  paymentMode: PaymentMode;
  stripePublishableKey: string | null;
}

export interface CreateReservationResponse {
  reservationId: string;
  reservationToken: string;         // send as header X-Reservation-Token on every reservation call
  clientSecret: string;             // Stripe client secret, or "fake_..." in fake mode
  minCents: number;
  expiresAt: string;
  paymentMode: PaymentMode;
}

export interface ConfirmReservationRequest {
  amountCents: number; name: string; proclamation: string; email: string;
  alertOptIn: boolean; termsAccepted: boolean;
}

export interface ReservationStatus {
  id: string; throne: ThroneId; state: ReservationState; failReason: FailReason | null;
  expiresAt: string; minCents: number; amountCents: number | null; reignId: string | null;
}

export interface ApiError { error: string; message: string; [extra: string]: unknown }

export type ThroneEvent =
  | { type: "throne.updated"; data: ThroneState }
  | { type: "reservation.updated"; data: { state: ReservationState | null; lockedUntil: string | null } }
  | { type: "presence.count"; data: { watching: number } }
  | { type: "reservation.result"; data: { reservationId: string; state: ReservationState; failReason: FailReason | null; reignId: string | null } };
