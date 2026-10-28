// OWNER: U. Pure view logic for the throne page and checkout (unit-tested in derive.test.ts).
import type { ThroneId, ThroneState, Title } from "@/lib/contracts";
import { copy, fill } from "@/lib/copy";
import { article, truncateName } from "@/lib/format";
import { DEFAULT_PRICING, TITLE_THRESHOLDS, titleFor, type PricingConfig } from "@/lib/pricing";

export type Money = (cents: number, round?: boolean) => string;

const ui = copy.ui;

export function titleRank(t: Title): number {
  return TITLE_THRESHOLDS.findIndex((x) => x.title === t);
}

/** FR-10, first match wins. */
export function ctaLabel(o: { mine: boolean; tryName: string; kingName: string | null; minCents: number; money: Money }): string {
  const price = o.money(o.minCents);
  if (o.mine) return fill(copy.ctaSelf, { price });
  if (o.tryName) return fill(copy.ctaTryOn, { name: truncateName(o.tryName, 16), price });
  if (o.kingName) return fill(copy.ctaOverthrow, { name: truncateName(o.kingName, 16), price });
  return fill(copy.ctaVacant, { price });
}

/** FR-11. */
export function pitchLine(o: { throne: ThroneId; king: { name: string; title: Title } | null; mine: boolean; minCents: number }): string {
  const next = titleFor(o.minCents);
  if (o.king && !o.mine && titleRank(next) > titleRank(o.king.title)) {
    return fill(ui.pitchHigher, { name: o.king.name, article: article(o.king.title), current: o.king.title, next });
  }
  return fill(ui.pitchTitle, { title: next, throneName: copy.throneName[o.throne] });
}

/** Percentage the price has fallen after `days` idle days: 1 − (1 − decay)^days, rounded. */
export function decayPercent(days: number, cfg: PricingConfig = DEFAULT_PRICING): number {
  return Math.round((1 - Math.pow(1 - cfg.decayBps / 10_000, days)) * 100);
}

/** FR-12. `now` is the skew-corrected client clock. */
export function metaLine(state: ThroneState, now: number, money: Money, formatDuration: (ms: number) => string, cfg: PricingConfig = DEFAULT_PRICING): string {
  const head = fill(ui.metaNext, { price: money(state.nextMinCentsAtMinimum) });
  let tail: string;
  if (state.throne === "daily") {
    const resetsAt = state.resetsAt ? Date.parse(state.resetsAt) : now;
    tail = fill(ui.metaDaily, { base: money(cfg.baseCents), duration: formatDuration(Math.max(0, resetsAt - now)) });
  } else if (state.idleDays > 0) {
    tail = fill(ui.metaDecayed, {
      days: state.idleDays,
      dayWord: state.idleDays === 1 ? ui.day : ui.days,
      pct: decayPercent(state.idleDays, cfg),
    });
  } else {
    tail = fill(ui.metaDecayRule, { pct: trimPct(cfg.decayBps) });
  }
  return `${head} ${tail}`;
}

function trimPct(bps: number): string {
  return String(Math.round(bps) / 100);
}
export const stepPercent = (cfg: PricingConfig = DEFAULT_PRICING) => trimPct(cfg.stepBps);

// ---------------------------------------------------------------------------------------------
// Checkout amount

/** Parses a euro amount typed by the buyer ("150", "2.42", "2,42", "1 000.5") into cents, or null. */
export function parseAmountToCents(raw: string): number | null {
  const s = raw.trim().replace(/[\s  €]/g, "").replace(",", ".");
  const m = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** "2.42" for the amount input. */
export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export interface ChipOption {
  key: "minimum" | "title" | "x2" | "x5";
  label: string;
  cents: number;
}

/** Quick price buttons: Minimum, Become <next title>, ×2, ×5 — sorted, equal amounts once (title wins), cap applied. */
export function chipOptions(minCents: number, maxCents: number): ChipOption[] {
  const opts: ChipOption[] = [{ key: "minimum", label: ui.chipMinimum, cents: minCents }];
  const next = TITLE_THRESHOLDS.find((t) => t.minCents > minCents);
  if (next) opts.push({ key: "title", label: fill(ui.chipBecome, { title: next.title }), cents: next.minCents });
  opts.push({ key: "x2", label: fill(ui.chipTimes, { n: 2 }), cents: minCents * 2 });
  opts.push({ key: "x5", label: fill(ui.chipTimes, { n: 5 }), cents: minCents * 5 });
  const priority = { title: 0, minimum: 1, x2: 2, x5: 3 } as const;
  const byAmount = new Map<number, ChipOption>();
  for (const o of opts) {
    if (o.cents > maxCents) continue;
    const seen = byAmount.get(o.cents);
    if (!seen || priority[o.key] < priority[seen.key]) byAmount.set(o.cents, o);
  }
  return [...byAmount.values()].sort((a, b) => a.cents - b.cents);
}

/** Live price help under the amount input. `bad` → red text and pay button disabled. */
export function amountHelp(o: { amountCents: number | null; minCents: number; maxCents: number; money: Money; nextOf: (c: number) => number }): {
  text: string;
  bad: boolean;
} {
  const { amountCents: a, minCents: min, maxCents: max, money } = o;
  if (a == null || a < min) return { text: fill(ui.helpBelow, { min: money(min) }), bad: true };
  if (a > max) return { text: fill(ui.helpAboveMax, { max: money(max, true) }), bad: true };
  let text = a === min ? ui.helpMinimum : fill(ui.helpAbove, { diff: money(a - min) });
  const t = titleFor(a);
  const tMin = titleFor(min);
  if (t !== tMin) text += fill(ui.helpRank, { a1: article(t), title: t, a2: article(tMin), minTitle: tMin });
  text += fill(ui.helpNext, { price: money(o.nextOf(a)) });
  return { text, bad: false };
}

/** Overpay in percent of the minimum, for analytics. */
export function overpayPercent(amountCents: number, minCents: number): number {
  return minCents > 0 ? Math.round(((amountCents - minCents) / minCents) * 1000) / 10 : 0;
}
