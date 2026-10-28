import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/format";
import { nextMinCents } from "@/lib/pricing";
import { boxesOverlap, CHART_H, CHART_W, ladderModel, stepOf, textBox } from "./ladder";

const fmt = {
  round: (c: number) => formatMoney(c, { round: true, locale: "en-IE" }),
  exact: (c: number) => formatMoney(c, { locale: "en-IE" }),
  takeover: (n: number) => `Takeover #${n}`,
  here: "You are here",
  start: "Start",
};

/** Realistic minimums: the minimum-step chain from €2.00 plus some overpaid and decayed prices. */
function samplePrices(): number[] {
  const out = new Set<number>([200, 201, 999, 1000, 15_000, 99_999, 1_000_000, 12_345_678, 100_000_000]);
  for (let p = 200; p <= 100_000_000; p = nextMinCents(p)) out.add(p);
  for (let p = 200; p <= 100_000_000; p = Math.round(p * 1.37)) out.add(p);
  return [...out];
}

describe("ladderModel", () => {
  it("places the current price on the curve and shows ≥ 100 steps", () => {
    expect(stepOf(200)).toBe(1);
    expect(stepOf(220)).toBe(2);
    expect(stepOf(242)).toBe(3);
    const m = ladderModel(242, fmt);
    expect(m.N).toBe(100);
    expect(m.m).toBe(25);
    expect(m.texts.map((t) => t.text)).toEqual(
      expect.arrayContaining(["You are here", "€2.42", "Takeover #25", "Takeover #100", "Start"]),
    );
  });

  it("never overlaps labels and keeps them inside the chart", () => {
    for (const price of samplePrices()) {
      const m = ladderModel(price, fmt);
      // The two axis labels sit below the baseline, far apart; check every label above the axis.
      const above = m.texts.filter((t) => t.y < m.axisY);
      const boxes = above.map(textBox);
      for (const b of boxes) {
        expect(b.x0, `price ${price}`).toBeGreaterThanOrEqual(0);
        expect(b.x1, `price ${price}`).toBeLessThanOrEqual(CHART_W);
        expect(b.y0, `price ${price}`).toBeGreaterThanOrEqual(0);
        expect(b.y1, `price ${price}`).toBeLessThanOrEqual(CHART_H);
      }
      // Labels come in pairs (title + value); pairs must not touch each other.
      for (let i = 0; i < above.length; i += 2) {
        for (let j = i + 2; j < above.length; j += 2) {
          for (const a of [boxes[i], boxes[i + 1]]) {
            for (const b of [boxes[j], boxes[j + 1]]) {
              expect(boxesOverlap(a, b, 0), `price ${price}: "${above[i].text}" vs "${above[j].text}"`).toBe(false);
            }
          }
        }
      }
      // "You are here" stays above its point.
      const here = above.find((t) => t.text === "You are here")!;
      expect(textBox(here).y1).toBeLessThan(m.here.cy);
    }
  });

  it("shows a milestone at least 15 steps ahead whenever the chart has room", () => {
    const m = ladderModel(200, fmt);
    expect(m.m).not.toBeNull();
    expect(m.m!).toBeGreaterThanOrEqual(m.n + 15);
    expect(m.m!).toBeLessThanOrEqual(m.N - 15);
  });
});
