import { describe, expect, it } from "vitest";
import { hasCombiningAbuse, normalizeField, normalizeSubmission, normalizeText, textLength } from "./normalize";

describe("normalizeText", () => {
  it("applies NFC", () => {
    const decomposed = "José"; // e + combining acute
    expect(normalizeText(decomposed)).toBe("José");
    expect(normalizeText(decomposed).length).toBe(4);
  });

  it("strips control, zero-width and bidi override characters", () => {
    expect(normalizeText("Ma​x")).toBe("Max");
    expect(normalizeText("‮naM‬")).toBe("naM");
    expect(normalizeText("A\u0000B\u0007C\u007F")).toBe("ABC");
    expect(normalizeText("﻿King⁦x⁩")).toBe("Kingx");
    expect(normalizeText("Ki­ng")).toBe("King");
  });

  it("collapses whitespace and trims", () => {
    expect(normalizeText("  Long \t\n live   the king  ")).toBe("Long live the king");
    expect(normalizeText("a b")).toBe("a b");
  });

  it("keeps emoji, including ZWJ sequences, flags and keycaps", () => {
    expect(normalizeText("King 👑")).toBe("King 👑");
    const family = "👨‍👩‍👧";
    expect(normalizeText(family)).toBe(family);
    expect(normalizeText("🇨🇭")).toBe("🇨🇭");
    const scotland = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
    expect(normalizeText(scotland)).toBe(scotland);
    expect(normalizeText("1️⃣")).toBe("1️⃣");
    expect(normalizeText("👍🏽")).toBe("👍🏽");
  });

  it("drops a ZWJ that is not inside an emoji sequence", () => {
    expect(normalizeText("sl‍ur")).toBe("slur");
  });

  it("drops invisible tag characters outside flag sequences", () => {
    expect(normalizeText("Max\u{E0069}\u{E0067}\u{E006E}")).toBe("Max");
  });
});

describe("combining marks", () => {
  it("allows up to 2 marks on one base character", () => {
    expect(hasCombiningAbuse("é")).toBe(false);
    expect(hasCombiningAbuse("ệ")).toBe(false);
    expect(hasCombiningAbuse("é̂")).toBe(false);
  });

  it("rejects more than 2 marks on one base character (Zalgo)", () => {
    expect(hasCombiningAbuse("é̂̃")).toBe(true);
    const f = normalizeField("name", "Z̶̷̸algo");
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.issue).toBe("combining_marks");
  });

  it("counts marks hidden in precomposed letters", () => {
    expect(normalizeField("name", "é̂̃").ok).toBe(false); // NFC "é" + 2 marks
  });

  it("checks after stripping, so hidden characters cannot split a run", () => {
    expect(normalizeField("name", "á​̂̃").ok).toBe(false);
  });
});

describe("length rules", () => {
  it("name must have 1–24 characters after normalization", () => {
    expect(normalizeField("name", "   ​ ")).toMatchObject({ ok: false, issue: "empty" });
    expect(normalizeField("name", "x".repeat(24))).toMatchObject({ ok: true, length: 24 });
    expect(normalizeField("name", "x".repeat(25))).toMatchObject({ ok: false, issue: "too_long", max: 24 });
    // whitespace collapsed before counting
    expect(normalizeField("name", `${"x".repeat(12)}      ${"y".repeat(11)}`)).toMatchObject({ ok: true, length: 24 });
  });

  it("proclamation may be empty and has at most 140 characters", () => {
    expect(normalizeField("proclamation", "")).toMatchObject({ ok: true, text: "" });
    expect(normalizeField("proclamation", "p".repeat(140)).ok).toBe(true);
    expect(normalizeField("proclamation", "p".repeat(141))).toMatchObject({ ok: false, issue: "too_long", max: 140 });
  });

  it("counts code points (an emoji outside the BMP is 1)", () => {
    expect(textLength("👑")).toBe(1);
    expect(normalizeField("name", "👑".repeat(24)).ok).toBe(true);
  });

  it("honours configured limits", () => {
    expect(normalizeField("name", "abcdef", { nameMax: 5, proclamationMax: 10 }).ok).toBe(false);
  });
});

describe("normalizeSubmission", () => {
  it("returns normalized texts", () => {
    expect(normalizeSubmission({ name: " Max​ ", proclamation: "  Bow   down " })).toEqual({
      ok: true,
      name: "Max",
      proclamation: "Bow down",
    });
  });

  it("reports the first failing field", () => {
    const r = normalizeSubmission({ name: "ok", proclamation: "p".repeat(200) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("proclamation");
  });
});
