// OWNER: F. Pure pricing rules (PRD "Core mechanics"). Integer cents only; every computation is
// done exactly with BigInt and rounded half up once at the end.
import type { ThroneId, Title } from "./contracts";

export interface PricingConfig {
  baseCents: number; // 200 = €2.00
  stepBps: number; // 1000 = +10% per takeover
  decayBps: number; // 200 = −2% per full idle day (eternal only)
  maxCents: number; // 100_000_000 = €1,000,000 cap per takeover
}

export const DEFAULT_PRICING: PricingConfig = {
  baseCents: 200,
  stepBps: 1000,
  decayBps: 200,
  maxCents: 100_000_000,
};

export const DAY_MS = 86_400_000;

export const TITLE_THRESHOLDS: { title: Title; minCents: number }[] = [
  { title: "Lord", minCents: 0 },
  { title: "Baron", minCents: 1_000 },
  { title: "Duke", minCents: 10_000 },
  { title: "Archduke", minCents: 100_000 },
  { title: "Emperor", minCents: 1_000_000 },
];

const BPS = BigInt(10_000);

/** num / den rounded half up (num, den ≥ 0). */
function roundHalfUp(num: bigint, den: bigint): number {
  return Number((num * BigInt(2) + den) / (den * BigInt(2)));
}

/** Full 24-hour periods since the last takeover (never negative). */
export function idleDays(crownedAt: Date, now: Date): number {
  const ms = now.getTime() - crownedAt.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / DAY_MS);
}

/** UTC calendar date key, e.g. "2026-10-28". */
export function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Next 00:00 UTC strictly after `now`. */
export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** round(paid × (1 + step)) — what the next challenger pays at least. */
export function nextMinCents(paidCents: number, cfg: PricingConfig = DEFAULT_PRICING): number {
  return roundHalfUp(BigInt(paidCents) * (BPS + BigInt(cfg.stepBps)), BPS);
}

/**
 * Current minimum price.
 * - never taken → base
 * - eternal: max(base, round(P × 1.10 × 0.98^d)), d = full idle days
 * - daily: last takeover on today's UTC date → max(base, round(P × 1.10)); otherwise base
 */
export function minPriceCents(
  throne: ThroneId,
  last: { paidCents: number; crownedAt: Date } | null,
  now: Date,
  cfg: PricingConfig = DEFAULT_PRICING,
): number {
  if (!last) return cfg.baseCents;
  if (throne === "daily") {
    if (utcDateKey(last.crownedAt) !== utcDateKey(now)) return cfg.baseCents;
    return Math.max(cfg.baseCents, nextMinCents(last.paidCents, cfg));
  }
  const d = idleDays(last.crownedAt, now);
  const stepped = BigInt(last.paidCents) * (BPS + BigInt(cfg.stepBps));
  if (d === 0 || cfg.decayBps === 0) return Math.max(cfg.baseCents, roundHalfUp(stepped, BPS));
  // Once the decayed price is below base, more days cannot raise it: cap the exponent so the
  // BigInt stays small (0.98^2000 ≈ 3e-18, far below any representable cent amount).
  const days = Math.min(d, 2000);
  const factor = BPS - BigInt(cfg.decayBps);
  const num = stepped * factor ** BigInt(days);
  const den = BPS ** BigInt(days + 1);
  return Math.max(cfg.baseCents, roundHalfUp(num, den));
}

export function titleFor(paidCents: number): Title {
  let title: Title = TITLE_THRESHOLDS[0].title;
  for (const t of TITLE_THRESHOLDS) if (paidCents >= t.minCents) title = t.title;
  return title;
}

/** The title after `title`, or null for Emperor. */
export function nextTitle(title: Title): { title: Title; minCents: number } | null {
  const i = TITLE_THRESHOLDS.findIndex((t) => t.title === title);
  return TITLE_THRESHOLDS[i + 1] ?? null;
}

/**
 * Price of the k-th takeover (1-based) on the pure curve base × (1 + step)^(k−1), rounded once.
 * Used for the ladder chart; it differs slightly from the real chain, which rounds every step.
 */
export function priceAtStep(k: number, cfg: PricingConfig = DEFAULT_PRICING): number {
  const n = Math.max(0, Math.floor(k) - 1);
  return roundHalfUp(BigInt(cfg.baseCents) * (BPS + BigInt(cfg.stepBps)) ** BigInt(n), BPS ** BigInt(n));
}

/** Validates a buyer-chosen amount against the locked minimum and the cap. */
export function isValidAmount(amountCents: number, minCents: number, cfg: PricingConfig = DEFAULT_PRICING): boolean {
  return Number.isSafeInteger(amountCents) && amountCents >= minCents && amountCents <= cfg.maxCents;
}
