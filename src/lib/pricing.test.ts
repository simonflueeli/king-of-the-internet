import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";
import {
  DEFAULT_PRICING,
  idleDays,
  isValidAmount,
  minPriceCents,
  nextMinCents,
  nextTitle,
  nextUtcMidnight,
  priceAtStep,
  titleFor,
} from "./pricing";

const H = 3_600_000;
const t0 = new Date("2026-03-01T12:00:00.000Z");
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

describe("AC-01: 30 minimum takeovers on a new Eternal Throne", () => {
  it("€2.00, €2.20, €2.42 … €31.72; total €328.92; next €34.89", () => {
    let last: { paidCents: number; crownedAt: Date } | null = null;
    const paid: number[] = [];
    let now = t0;
    for (let i = 0; i < 30; i++) {
      const min = minPriceCents("eternal", last, now);
      paid.push(min);
      last = { paidCents: min, crownedAt: now };
      now = at(now, 60_000); // a minute later
    }
    expect(paid.slice(0, 4)).toEqual([200, 220, 242, 266]);
    expect(paid[29]).toBe(3172);
    expect(paid.reduce((a, b) => a + b, 0)).toBe(32892);
    expect(minPriceCents("eternal", last, now)).toBe(3489);
    expect(formatMoney(paid[29], { locale: "en-IE" })).toBe("€31.72");
  });
});

describe("AC-02: eternal decay", () => {
  it("€100 last paid → €110.00, €107.80, €105.64, €103.53 after 0/24/49/72 h", () => {
    const last = { paidCents: 10_000, crownedAt: t0 };
    expect([0, 24, 49, 72].map((h) => minPriceCents("eternal", last, at(t0, h * H)))).toEqual([
      11_000, 10_780, 10_564, 10_353,
    ]);
  });

  it("no decay before a full 24 h", () => {
    const last = { paidCents: 10_000, crownedAt: t0 };
    expect(minPriceCents("eternal", last, at(t0, 24 * H - 1))).toBe(11_000);
    expect(idleDays(t0, at(t0, 24 * H - 1))).toBe(0);
    expect(idleDays(t0, at(t0, 24 * H))).toBe(1);
    expect(idleDays(t0, at(t0, -5 * H))).toBe(0);
  });
});

describe("AC-03: floor", () => {
  it("€2.00 last paid, 10 days idle → €2.00", () => {
    const last = { paidCents: 200, crownedAt: t0 };
    expect(minPriceCents("eternal", last, at(t0, 10 * 24 * H))).toBe(200);
  });

  it("stays at the floor after years of idling (no overflow)", () => {
    const last = { paidCents: 100_000_000, crownedAt: t0 };
    expect(minPriceCents("eternal", last, at(t0, 5000 * 24 * H))).toBe(200);
  });
});

describe("AC-04: daily reset", () => {
  it("crowned at 23:59 UTC → base price after 00:00 UTC", () => {
    const crownedAt = new Date("2026-03-01T23:59:00.000Z");
    const last = { paidCents: 5_000, crownedAt };
    expect(minPriceCents("daily", last, new Date("2026-03-01T23:59:59.999Z"))).toBe(5_500);
    expect(minPriceCents("daily", last, new Date("2026-03-02T00:00:00.000Z"))).toBe(200);
    expect(nextUtcMidnight(crownedAt).toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });

  it("daily throne never decays within the day", () => {
    const crownedAt = new Date("2026-03-01T00:00:01.000Z");
    const last = { paidCents: 10_000, crownedAt };
    expect(minPriceCents("daily", last, new Date("2026-03-01T23:59:59.000Z"))).toBe(11_000);
  });

  it("never taken → base", () => {
    expect(minPriceCents("daily", null, t0)).toBe(200);
    expect(minPriceCents("eternal", null, t0)).toBe(200);
  });
});

describe("AC-05: titles", () => {
  it("€150 → Duke, next minimum €165.00", () => {
    expect(titleFor(15_000)).toBe("Duke");
    expect(nextMinCents(15_000)).toBe(16_500);
  });

  it("thresholds", () => {
    expect(titleFor(200)).toBe("Lord");
    expect(titleFor(999)).toBe("Lord");
    expect(titleFor(1_000)).toBe("Baron");
    expect(titleFor(9_999)).toBe("Baron");
    expect(titleFor(10_000)).toBe("Duke");
    expect(titleFor(99_999)).toBe("Duke");
    expect(titleFor(100_000)).toBe("Archduke");
    expect(titleFor(999_999)).toBe("Archduke");
    expect(titleFor(1_000_000)).toBe("Emperor");
    expect(nextTitle("Lord")).toEqual({ title: "Baron", minCents: 1_000 });
    expect(nextTitle("Emperor")).toBeNull();
  });
});

describe("rounding and helpers", () => {
  it("rounds half up once", () => {
    expect(nextMinCents(5)).toBe(6); // 5.5 → 6
    expect(nextMinCents(15)).toBe(17); // 16.5 → 17
    expect(nextMinCents(266)).toBe(293); // 292.6 → 293
  });

  it("priceAtStep follows the unrounded curve", () => {
    expect(priceAtStep(1)).toBe(200);
    expect(priceAtStep(2)).toBe(220);
    expect(priceAtStep(4)).toBe(266); // 266.2
    expect(priceAtStep(30)).toBe(3173); // 2 × 1.1^29 = 31.7253… (the rounded chain gives 31.72)
  });

  it("isValidAmount (AC-06 bounds)", () => {
    expect(isValidAmount(242, 242)).toBe(true);
    expect(isValidAmount(241, 242)).toBe(false);
    expect(isValidAmount(DEFAULT_PRICING.maxCents, 242)).toBe(true);
    expect(isValidAmount(DEFAULT_PRICING.maxCents + 1, 242)).toBe(false);
    expect(isValidAmount(242.5, 242)).toBe(false);
  });
});
