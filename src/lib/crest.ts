// OWNER: F. Deterministic coat of arms (PRD "Crest algorithm"), ported from the prototype's
// crestGroup(). Pure string output so client, server and OG images draw the same crest.

export const CREST_TINCTURES = ["#A3243B", "#22409A", "#1E6B47", "#5B2A86", "#1A1A22", "#B4561C"] as const;
export const CREST_VACANT_FIELD = "#3A4280";
export const CREST_GOLD = "#E2B04A";
export const CREST_SILVER = "#F4F2EA";
export const CREST_SHIELD_PATH = "M6 6H94V58C94 92 72 108 50 116 28 108 6 92 6 58Z";

export type CrestDivision = 0 | 1 | 2 | 3 | 4; // plain, per pale, per fess, per bend, chevron

/** 32-bit FNV-1a over Unicode code points. */
export function crestHash(s: string): number {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function crestSpec(name: string | null): { field: string; second: string; division: CrestDivision; initial: string } {
  const vacant = !name;
  const h = crestHash((name || "").toLowerCase());
  const first = Array.from((name || "").trim())[0];
  return {
    field: vacant ? CREST_VACANT_FIELD : CREST_TINCTURES[h % CREST_TINCTURES.length],
    second: (h >>> 4) % 2 ? CREST_GOLD : CREST_SILVER,
    division: vacant ? 0 : (((h >>> 7) % 5) as CrestDivision),
    initial: first ? first.toUpperCase() : "?",
  };
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function divisionMarkup(division: CrestDivision, second: string): string {
  switch (division) {
    case 1:
      return `<rect x="50" y="0" width="50" height="120" fill="${second}"/>`;
    case 2:
      return `<rect x="0" y="0" width="100" height="48" fill="${second}"/>`;
    case 3:
      return `<polygon points="0,0 100,0 100,120" fill="${second}"/>`;
    case 4:
      return `<polygon points="0,86 50,42 100,86 100,106 50,62 0,106" fill="${second}"/>`;
    default:
      return "";
  }
}

/**
 * The crest's inner markup (a <g> in the 100 × 120 crest coordinate space), e.g. to place on the
 * throne's backrest with transform="translate(70 42) scale(.6)".
 */
export function crestGroup(name: string | null, opts?: { idPrefix?: string }): string {
  const spec = crestSpec(name);
  const clipId = `${opts?.idPrefix ?? "crest"}-${crestHash((name || "").toLowerCase()).toString(36)}-clip`;
  return (
    `<g>` +
    `<defs><clipPath id="${clipId}"><path d="${CREST_SHIELD_PATH}"/></clipPath></defs>` +
    `<path d="${CREST_SHIELD_PATH}" fill="${spec.field}"/>` +
    `<g clip-path="url(#${clipId})">${divisionMarkup(spec.division, spec.second)}</g>` +
    `<path d="${CREST_SHIELD_PATH}" fill="none" stroke="#E9BE5A" stroke-width="5"/>` +
    `<circle cx="50" cy="56" r="21" fill="#F6D77A" stroke="#8A5C10" stroke-width="2"/>` +
    // The class lets the page CSS swap in the next/font family (globals.css .crest-initial).
    `<text class="crest-initial" x="50" y="57" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="UnifrakturMaguntia, Georgia, serif" font-size="30" fill="#2A1C05">${escapeXml(spec.initial)}</text>` +
    `</g>`
  );
}

/**
 * Full standalone <svg> markup, viewBox 0 0 100 120. `size` sets the width in px (height = 1.2 ×).
 * `idPrefix` namespaces the clipPath id; ids are derived from the name, so output is deterministic.
 */
export function crestSvg(name: string | null, opts?: { size?: number; idPrefix?: string }): string {
  const dims = opts?.size ? ` width="${opts.size}" height="${Math.round(opts.size * 1.2 * 100) / 100}"` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120"${dims} class="crest" aria-hidden="true">` +
    crestGroup(name, { idPrefix: opts?.idPrefix }) +
    `</svg>`
  );
}
