import { describe, expect, it } from "vitest";
import { CREST_TINCTURES, crestGroup, crestHash, crestSpec, crestSvg } from "./crest";

// Reference implementation copied from docs/prototype.html (hashStr + crestGroup's choices).
function prototypeSpec(name: string) {
  let h = 2166136261;
  for (const ch of name.toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  h = h >>> 0;
  const vacant = !name;
  const first = Array.from((name || "").trim())[0];
  return {
    field: vacant ? "#3A4280" : ["#A3243B", "#22409A", "#1E6B47", "#5B2A86", "#1A1A22", "#B4561C"][h % 6],
    second: (h >>> 4) % 2 ? "#E2B04A" : "#F4F2EA",
    division: vacant ? 0 : (h >>> 7) % 5,
    initial: first ? first.toUpperCase() : "?",
  };
}

describe("crest", () => {
  it("FNV-1a 32-bit over code points", () => {
    expect(crestHash("")).toBe(2166136261);
    expect(crestHash("a")).toBe(0xe40c292c);
    expect(crestHash("foobar")).toBe(0xbf9cf968);
  });

  it("matches the prototype for many names", () => {
    const names = ["Max", "max", "Élodie", "李小龙", "👑 King", "  spaced  ", "O'Brien", "Zoë", "ß", "a"];
    for (const n of names) expect(crestSpec(n)).toEqual(prototypeSpec(n));
  });

  it("is case-insensitive for colors but keeps the initial uppercased", () => {
    expect(crestSpec("MAX")).toEqual(crestSpec("max"));
    expect(crestSpec("max").initial).toBe("M");
  });

  it("vacant crest", () => {
    expect(crestSpec(null)).toEqual({ field: "#3A4280", second: "#F4F2EA", division: 0, initial: "?" });
    expect(crestSpec("")).toEqual(crestSpec(null));
  });

  it("covers every division and tincture", () => {
    const divisions = new Set<number>();
    const fields = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const s = crestSpec(`name${i}`);
      divisions.add(s.division);
      fields.add(s.field);
    }
    expect([...divisions].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(fields.size).toBe(CREST_TINCTURES.length);
  });

  it("produces deterministic, well-formed SVG", () => {
    const a = crestSvg("Max", { size: 64 });
    expect(crestSvg("Max", { size: 64 })).toBe(a);
    expect(a).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 100 120" width="64" height="76.8"/);
    expect(a).toContain(`fill="${crestSpec("Max").field}"`);
    expect(a).toContain(">M</text>");
    expect(crestSvg(null)).toContain(">?</text>");
    expect(crestSvg(null)).toContain('fill="#3A4280"');
    expect(crestGroup("Max", { idPrefix: "hero" })).toContain('clip-path="url(#hero-');
  });

  it("escapes the initial", () => {
    expect(crestSvg("<script>")).toContain(">&lt;</text>");
    expect(crestSvg("&co")).toContain(">&amp;</text>");
  });
});
