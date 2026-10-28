// OWNER: U. Geometry for the price ladder chart (FR-40/41): the minimum-step curve from the base price,
// "You are here", one milestone 15+ steps ahead and the final step. Labels are placed with simple
// bounding-box collision checks so they never overlap each other or the curve (verified in ladder.test.ts).
import { DEFAULT_PRICING, priceAtStep, type PricingConfig } from "@/lib/pricing";

export const CHART_W = 460;
export const CHART_H = 250;
const L = 14;
const R = 14;
const T = 34;
const B = 30;
const MILESTONES = [25, 50, 75, 100, 150, 200, 300, 500];

export type TextClass = "ct" | "ct-strong" | "ct-gold";

export interface ChartText {
  cls: TextClass;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  text: string;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LadderModel {
  /** Step of the current price on the curve. */
  n: number;
  /** Last step shown (≥ 100). */
  N: number;
  /** Milestone step, or null when none fits. */
  m: number | null;
  priceAtM: number | null;
  priceAtN: number;
  linePath: string;
  areaPath: string;
  axisY: number;
  here: { cx: number; cy: number; leaderTopY: number };
  milestonePoint: { x: number; y: number } | null;
  finalPoint: { x: number; y: number };
  texts: ChartText[];
}

const FONT: Record<TextClass, { size: number; w: number }> = {
  ct: { size: 14, w: 0.58 },
  "ct-strong": { size: 15, w: 0.64 },
  "ct-gold": { size: 15, w: 0.64 },
};

/** Approximate bounding box of an SVG text (generous: wide glyph factor, ascent 0.8, descent 0.25). */
export function textBox(t: ChartText): Box {
  const f = FONT[t.cls];
  const w = Array.from(t.text).length * f.size * f.w;
  const x0 = t.anchor === "start" ? t.x : t.anchor === "end" ? t.x - w : t.x - w / 2;
  return { x0, y0: t.y - f.size * 0.8, x1: x0 + w, y1: t.y + f.size * 0.25 };
}

export function boxesOverlap(a: Box, b: Box, pad = 2): boolean {
  return a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;
}

function union(a: Box, b: Box): Box {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/** Index of the current price on the pure curve base × (1+step)^(k−1). */
export function stepOf(priceCents: number, cfg: PricingConfig = DEFAULT_PRICING): number {
  const ratio = priceCents / cfg.baseCents;
  if (ratio <= 1) return 1;
  return Math.max(1, Math.round(Math.log(ratio) / Math.log(1 + cfg.stepBps / 10_000)) + 1);
}

export function ladderModel(
  priceCents: number,
  fmt: { round: (cents: number) => string; exact: (cents: number) => string; takeover: (n: number) => string; here: string; start: string },
  cfg: PricingConfig = DEFAULT_PRICING,
): LadderModel {
  const n = stepOf(priceCents, cfg);
  const N = Math.max(100, Math.ceil((n * 1.3) / 10) * 10);
  const pmax = priceAtStep(N, cfg);
  const x = (k: number) => L + ((k - 1) / (N - 1)) * (CHART_W - L - R);
  const y = (v: number) => CHART_H - B - (v / pmax) * (CHART_H - T - B);
  const axisY = CHART_H - B;

  const pts: { x: number; y: number }[] = [];
  for (let k = 1; k <= N; k++) pts.push({ x: x(k), y: y(priceAtStep(k, cfg)) });
  const linePath = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("");
  const areaPath = `${linePath}L${x(N).toFixed(1)} ${axisY}L${x(1).toFixed(1)} ${axisY}Z`;

  // Does the curve pass through a box? Sample densely between steps.
  const curveHits = (b: Box) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const c = pts[i + 1];
      if (c.x < b.x0 - 2 || a.x > b.x1 + 2) continue;
      for (let s = 0; s <= 4; s++) {
        const px = a.x + ((c.x - a.x) * s) / 4;
        const py = a.y + ((c.y - a.y) * s) / 4;
        if (px >= b.x0 - 2 && px <= b.x1 + 2 && py >= b.y0 - 3 && py <= b.y1 + 3) return true;
      }
    }
    return false;
  };
  const inBounds = (b: Box) => b.x0 >= 2 && b.x1 <= CHART_W - 2 && b.y0 >= 2 && b.y1 <= axisY - 2;

  const texts: ChartText[] = [];
  const taken: Box[] = [];
  const fits = (b: Box) => inBounds(b) && !curveHits(b) && !taken.some((t) => boxesOverlap(t, b));
  const place = (pair: [ChartText, ChartText]) => {
    texts.push(...pair);
    taken.push(union(textBox(pair[0]), textBox(pair[1])));
  };

  // 1. Final step, top right (always shown).
  const finalPoint = { x: x(N), y: y(pmax) };
  const finalPair: [ChartText, ChartText] = [
    { cls: "ct-strong", x: finalPoint.x - 10, y: T + 6, anchor: "end", text: fmt.takeover(N) },
    { cls: "ct", x: finalPoint.x - 10, y: T + 22, anchor: "end", text: fmt.round(pmax) },
  ];
  place(finalPair);

  // 2. "You are here" above the current point, right of the leader if possible, else left; lower rows if needed.
  const cx = x(n);
  const cy = y(priceCents);
  let herePair: [ChartText, ChartText] | null = null;
  const rows = [64, 92, 120, 148, 176];
  outer: for (const top of rows) {
    if (top + 18 + 4 > cy - 12) break; // must stay above the point
    for (const side of ["start", "end"] as const) {
      const tx = side === "start" ? cx + 8 : cx - 8;
      const pair: [ChartText, ChartText] = [
        { cls: "ct-gold", x: tx, y: top, anchor: side, text: fmt.here },
        { cls: "ct-strong", x: tx, y: top + 18, anchor: side, text: fmt.exact(priceCents) },
      ];
      if (fits(union(textBox(pair[0]), textBox(pair[1])))) {
        herePair = pair;
        break outer;
      }
    }
  }
  if (!herePair) {
    // Last resort (never hit for real prices, see tests): left of the point at its height.
    herePair = [
      { cls: "ct-gold", x: cx - 14, y: cy - 22, anchor: "end", text: fmt.here },
      { cls: "ct-strong", x: cx - 14, y: cy - 4, anchor: "end", text: fmt.exact(priceCents) },
    ];
  }
  place(herePair);
  const leaderTopY = herePair[1].y + 6;

  // 3. One milestone 15+ steps ahead of the current price and 15+ before the end, if a spot is free.
  let m: number | null = null;
  let milestonePoint: { x: number; y: number } | null = null;
  for (const cand of MILESTONES) {
    if (cand < n + 15 || cand > N - 15) continue;
    const mx = x(cand);
    const my = y(priceAtStep(cand, cfg));
    const options: [ChartText, ChartText][] = [
      [
        { cls: "ct-strong", x: mx, y: my - 26, anchor: "middle", text: fmt.takeover(cand) },
        { cls: "ct", x: mx, y: my - 10, anchor: "middle", text: fmt.round(priceAtStep(cand, cfg)) },
      ],
      [
        { cls: "ct-strong", x: mx - 8, y: my - 26, anchor: "end", text: fmt.takeover(cand) },
        { cls: "ct", x: mx - 8, y: my - 10, anchor: "end", text: fmt.round(priceAtStep(cand, cfg)) },
      ],
    ];
    // The dashed leader of "You are here" occupies a thin column.
    const leader: Box = { x0: cx - 1, y0: leaderTopY, x1: cx + 1, y1: cy };
    const pair = options.find((p) => {
      const b = union(textBox(p[0]), textBox(p[1]));
      return fits(b) && !boxesOverlap(b, leader);
    });
    if (pair) {
      place(pair);
      m = cand;
      milestonePoint = { x: mx, y: my };
      break;
    }
  }

  // 4. Axis labels under the baseline.
  texts.push({ cls: "ct", x: L, y: CHART_H - 9, anchor: "start", text: fmt.start });
  texts.push({ cls: "ct", x: CHART_W - R, y: CHART_H - 9, anchor: "end", text: fmt.takeover(N) });

  return {
    n, N, m,
    priceAtM: m == null ? null : priceAtStep(m, cfg),
    priceAtN: pmax,
    linePath, areaPath, axisY,
    here: { cx, cy, leaderTopY },
    milestonePoint,
    finalPoint,
    texts,
  };
}
