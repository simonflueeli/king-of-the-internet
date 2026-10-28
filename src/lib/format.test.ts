import { describe, expect, it } from "vitest";
import { fill } from "./copy";
import { article, formatAgo, formatClock, formatDuration, formatMoney, truncateName } from "./format";
import { hasCombiningAbuse, normalizeText, textLength } from "./normalize";

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

describe("formatDuration", () => {
  it("PRD formats", () => {
    expect(formatDuration(41 * S)).toBe("41s");
    expect(formatDuration(12 * M + 3 * S)).toBe("12m 03s");
    expect(formatDuration(2 * H + 14 * M + 9 * S)).toBe("2h 14m 09s");
    expect(formatDuration(3 * D + 4 * H + 5 * M + 59 * S)).toBe("3d 4h 05m");
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(-5)).toBe("0s");
    expect(formatDuration(999)).toBe("0s");
  });
});

describe("formatAgo", () => {
  it("PRD formats", () => {
    expect(formatAgo(59 * S)).toBe("just now");
    expect(formatAgo(1 * M)).toBe("1 minute ago");
    expect(formatAgo(4 * M)).toBe("4 minutes ago");
    expect(formatAgo(2 * H)).toBe("2 hours ago");
    expect(formatAgo(1 * D)).toBe("1 day ago");
    expect(formatAgo(3 * D)).toBe("3 days ago");
  });
});

describe("formatClock", () => {
  it("m:ss rounded up", () => {
    expect(formatClock(161_000)).toBe("2:41");
    expect(formatClock(179_001)).toBe("3:00");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-1)).toBe("0:00");
  });
});

describe("formatMoney", () => {
  it("formats cents as EUR", () => {
    expect(formatMoney(242, { locale: "en-IE" })).toBe("€2.42");
    expect(formatMoney(100_000_000, { locale: "en-IE" })).toBe("€1,000,000.00");
    expect(formatMoney(200, { locale: "en-IE", round: true })).toBe("€2");
    expect(formatMoney(32_892, { locale: "en-IE" })).toBe("€328.92");
  });
});

describe("small helpers", () => {
  it("article, truncateName, fill", () => {
    expect(article("Archduke")).toBe("an");
    expect(article("Duke")).toBe("a");
    expect(truncateName("Maximilian the Great")).toBe("Maximilian the …");
    expect(truncateName("Max")).toBe("Max");
    expect(fill("Overthrow {name} for {price}", { name: "Max", price: "€2.42" })).toBe("Overthrow Max for €2.42");
    expect(fill("{missing}", {})).toBe("{missing}");
  });
});

describe("normalizeText", () => {
  it("NFC, strips invisible/bidi/control characters, collapses whitespace", () => {
    expect(normalizeText("  Max \n\t the   Great ")).toBe("Max the Great");
    expect(normalizeText("Ma\u200Bx")).toBe("Max");
    expect(normalizeText("\u202EevilName")).toBe("evilName");
    expect(normalizeText("e\u0301")).toBe("é");
    expect(normalizeText("a\u0000b")).toBe("ab");
    expect(normalizeText("👨\u200D👩\u200D👧 family")).toBe("👨\u200D👩\u200D👧 family"); // ZWJ kept
  });

  it("combining abuse and length", () => {
    expect(hasCombiningAbuse("e\u0301\u0302")).toBe(false);
    expect(hasCombiningAbuse("e\u0301\u0302\u0303")).toBe(true);
    expect(textLength("👑ab")).toBe(3);
  });
});
