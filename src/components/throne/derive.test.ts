import { describe, expect, it } from "vitest";
import type { ThroneState } from "@/lib/contracts";
import { formatDuration, formatMoney } from "@/lib/format";
import { nextMinCents } from "@/lib/pricing";
import { amountHelp, centsToInput, chipOptions, ctaLabel, decayPercent, metaLine, parseAmountToCents, pitchLine } from "./derive";

const money = (c: number, round?: boolean) => formatMoney(c, { round, locale: "en-IE" });

describe("ctaLabel (FR-10)", () => {
  const base = { mine: false, tryName: "", kingName: null as string | null, minCents: 242, money };
  it("follows the first-match order", () => {
    expect(ctaLabel({ ...base, mine: true, tryName: "Ann", kingName: "Max" })).toBe("Crown yourself again for €2.42");
    expect(ctaLabel({ ...base, tryName: "Ann", kingName: "Max" })).toBe("Take the throne as Ann for €2.42");
    expect(ctaLabel({ ...base, kingName: "Max" })).toBe("Overthrow Max for €2.42");
    expect(ctaLabel(base)).toBe("Claim the empty throne for €2.42");
  });
  it("truncates names over 16 characters", () => {
    expect(ctaLabel({ ...base, kingName: "Bartholomew the Bold" })).toBe("Overthrow Bartholomew the… for €2.42");
  });
});

describe("pitchLine (FR-11)", () => {
  it("mentions the higher title when the minimum buys one", () => {
    expect(pitchLine({ throne: "eternal", king: { name: "Max", title: "Lord" }, mine: false, minCents: 1_045 })).toBe(
      "Max is only a Lord. You’d be crowned Baron.",
    );
    expect(pitchLine({ throne: "eternal", king: { name: "Eve", title: "Archduke" }, mine: false, minCents: 1_100_000 })).toBe(
      "Eve is only an Archduke. You’d be crowned Emperor.",
    );
  });
  it("otherwise names the title and throne", () => {
    expect(pitchLine({ throne: "daily", king: { name: "Max", title: "Lord" }, mine: false, minCents: 242 })).toBe(
      "You’ll be crowned Lord of the Daily Throne.",
    );
    expect(pitchLine({ throne: "eternal", king: null, mine: false, minCents: 200 })).toBe("You’ll be crowned Lord of the Eternal Throne.");
  });
});

describe("metaLine (FR-12)", () => {
  const state = (patch: Partial<ThroneState>): ThroneState =>
    ({ throne: "eternal", nextMinCentsAtMinimum: 266, idleDays: 0, resetsAt: null, ...patch }) as ThroneState;
  it("eternal: decay rule or fallen price", () => {
    expect(metaLine(state({}), 0, money, formatDuration)).toBe(
      "If you pay the minimum, the next challenger pays €2.66. If no one takes it for 24 hours, the price falls 2% a day.",
    );
    expect(metaLine(state({ idleDays: 3 }), 0, money, formatDuration)).toBe(
      "If you pay the minimum, the next challenger pays €2.66. Untouched for 3 days, so the price has fallen 6%.",
    );
    expect(decayPercent(1)).toBe(2);
  });
  it("daily: reset countdown", () => {
    const now = Date.parse("2026-10-28T18:47:57Z");
    expect(metaLine(state({ throne: "daily", resetsAt: "2026-10-29T00:00:00.000Z" }), now, money, formatDuration)).toBe(
      "If you pay the minimum, the next challenger pays €2.66. Resets to €2.00 at midnight UTC, in 5h 12m 03s.",
    );
  });
});

describe("checkout amount", () => {
  it("parses typed euro amounts to cents", () => {
    expect(parseAmountToCents("2.42")).toBe(242);
    expect(parseAmountToCents("2,4")).toBe(240);
    expect(parseAmountToCents(" 150 ")).toBe(15_000);
    expect(parseAmountToCents("€1 000.5")).toBe(100_050);
    expect(parseAmountToCents("2.421")).toBeNull();
    expect(parseAmountToCents("-1")).toBeNull();
    expect(parseAmountToCents("")).toBeNull();
    expect(centsToInput(242)).toBe("2.42");
    expect(centsToInput(15_000)).toBe("150.00");
  });

  it("builds quick chips sorted, deduped with the title label winning, capped", () => {
    expect(chipOptions(242, 100_000_000).map((c) => [c.label, c.cents])).toEqual([
      ["Minimum", 242],
      ["×2", 484],
      ["Become Baron", 1_000],
      ["×5", 1_210],
    ]);
    expect(chipOptions(500, 100_000_000).map((c) => c.label)).toEqual(["Minimum", "Become Baron", "×5"]);
    expect(chipOptions(30_000_000, 100_000_000).map((c) => c.label)).toEqual(["Minimum", "×2"]);
  });

  it("explains the chosen amount", () => {
    const o = { minCents: 200, maxCents: 100_000_000, money, nextOf: (c: number) => nextMinCents(c) };
    expect(amountHelp({ ...o, amountCents: 15_000 })).toEqual({
      text: "€148.00 above the minimum. You’ll rank as a Duke instead of a Lord. The next challenger pays €165.00.",
      bad: false,
    });
    expect(amountHelp({ ...o, amountCents: 200 }).text).toBe("That’s the minimum. The next challenger pays €2.20.");
    expect(amountHelp({ ...o, amountCents: 199 })).toEqual({ text: "The minimum is €2.00.", bad: true });
    expect(amountHelp({ ...o, amountCents: null }).bad).toBe(true);
    expect(amountHelp({ ...o, amountCents: 100_000_001 })).toEqual({ text: "The most you can pay is €1,000,000.", bad: true });
  });
});
