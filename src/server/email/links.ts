// OWNER: G. Absolute URLs and signed tokens for links in emails (reclaim, unsubscribe, reign pages).
import type { ThroneId } from "@/lib/contracts";
import { signToken, verifyToken } from "../hash";

const RECLAIM = "reclaim";
const UNSUBSCRIBE = "unsubscribe";
/** Unsubscribe links must keep working long after the email was sent. */
const UNSUBSCRIBE_TTL_MS = 5 * 365 * 86_400_000;

export function appUrl(pathname = "/"): string {
  const base = process.env.APP_URL || "http://localhost:3000";
  return new URL(pathname, base).toString();
}

export function thronePath(throne: ThroneId): string {
  return throne === "daily" ? "/daily" : "/";
}

export function reignUrl(reignId: string): string {
  return appUrl(`/r/${reignId}`);
}

export interface ReclaimPayload {
  /** The reign that was overthrown (its name is prefilled). */
  r: string;
  t: ThroneId;
}

export function reclaimToken(p: ReclaimPayload, ttlMs: number): string {
  return signToken(RECLAIM, p, ttlMs);
}

export function verifyReclaimToken(token: string): (ReclaimPayload & { exp: number }) | null {
  const p = verifyToken<ReclaimPayload>(RECLAIM, token);
  return p && typeof p.r === "string" && (p.t === "eternal" || p.t === "daily") ? p : null;
}

export function reclaimUrl(p: ReclaimPayload, ttlMs: number): string {
  return appUrl(`/api/reclaim?token=${encodeURIComponent(reclaimToken(p, ttlMs))}`);
}

export interface UnsubscribePayload {
  /** customers.id */
  c: string;
}

export function unsubscribeToken(customerId: string): string {
  return signToken<UnsubscribePayload>(UNSUBSCRIBE, { c: customerId }, UNSUBSCRIBE_TTL_MS);
}

export function verifyUnsubscribeToken(token: string): (UnsubscribePayload & { exp: number }) | null {
  const p = verifyToken<UnsubscribePayload>(UNSUBSCRIBE, token);
  return p && typeof p.c === "string" ? p : null;
}

export function unsubscribeUrl(customerId: string): string {
  return appUrl(`/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken(customerId))}`);
}
