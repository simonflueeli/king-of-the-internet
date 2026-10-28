// OWNER: F. Salted hashing for stored identifiers (IPs, device ids, ban values) and HMAC-signed
// tokens (reclaim / unsubscribe links). Node runtime only.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { nowMs } from "./clock";

function secret(name: "HASH_SALT" | "TOKEN_SECRET"): string {
  const v = process.env[name];
  if (v) return v;
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error(`${name} must be set in production`);
  }
  return `dev-${name.toLowerCase()}`;
}

/** Salted SHA-256 (hex). `purpose` separates namespaces so equal inputs hash differently per use. */
export function saltedHash(purpose: string, value: string): string {
  return createHash("sha256").update(`${secret("HASH_SALT")}\u0000${purpose}\u0000${value}`).digest("hex");
}

export const hashIp = (ip: string) => saltedHash("ip", ip);
export const hashDevice = (deviceId: string) => saltedHash("device", deviceId);
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const hashEmail = (email: string) => saltedHash("email", normalizeEmail(email));

/** Hash stored in bans.value_hash; email values are normalized first. */
export function hashBanValue(kind: "email" | "card" | "ip" | "device", value: string): string {
  return saltedHash(`ban:${kind}`, kind === "email" ? normalizeEmail(value) : value);
}

/** Unsalted SHA-256 (hex) of a high-entropy random token (reservation tokens, session ids). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function hmac(data: string): string {
  return createHmac("sha256", secret("TOKEN_SECRET")).update(data).digest("base64url");
}

/**
 * Signed, expiring token: base64url(JSON payload + exp).signature. `purpose` is bound into the
 * signature so a token minted for one use (e.g. "unsubscribe") cannot be replayed for another.
 */
export function signToken<T extends object>(purpose: string, payload: T, ttlMs: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: nowMs() + ttlMs })).toString("base64url");
  return `${body}.${hmac(`${purpose}.${body}`)}`;
}

/** Returns the payload (with `exp`) or null when malformed, tampered with, or expired. */
export function verifyToken<T extends object>(purpose: string, token: string): (T & { exp: number }) | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, hmac(`${purpose}.${body}`))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof payload.exp !== "number" || payload.exp <= nowMs()) return null;
    return payload;
  } catch {
    return null;
  }
}
