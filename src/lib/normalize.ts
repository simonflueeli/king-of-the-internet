// OWNER: S (F ships this basic version). Text normalization applied before any moderation check
// and before storing names/proclamations (PRD "Text normalization").

// C0/C1 controls (incl. tab/newline — whitespace is collapsed anyway), zero-width characters,
// bidi embeddings/overrides/isolates, soft hyphen, BOM. U+200D (ZWJ) is kept: emoji sequences need it.
const STRIP_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u180E\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const WHITESPACE_RE = /\s+/g;
const COMBINING_RUN_RE = /\p{M}{3,}/u;

/** NFC, strip invisible/control/bidi characters, collapse whitespace to single spaces, trim. */
export function normalizeText(input: string): string {
  return input.normalize("NFC").replace(STRIP_RE, "").replace(WHITESPACE_RE, " ").trim();
}

/** More than 2 combining marks on one base character ("Zalgo" text). */
export function hasCombiningAbuse(input: string): boolean {
  return COMBINING_RUN_RE.test(input);
}

/** Length in Unicode code points, as used for the name (1–24) and proclamation (0–140) limits. */
export function textLength(input: string): number {
  return Array.from(input).length;
}
