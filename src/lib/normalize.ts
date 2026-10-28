// OWNER: S. Text normalization applied before any moderation check and before storing
// names/proclamations (PRD "Text normalization"). Isomorphic: the checkout form can use the same
// rules for its live counter.
//
//   1. Unicode NFC.
//   2. Remove control, zero-width, bidi and other invisible characters. Emoji stay: U+200D (ZWJ)
//      is kept only between emoji, emoji tag sequences (subdivision flags) are kept intact.
//   3. Collapse whitespace to single spaces and trim.
//   4. Reject more than 2 combining marks on one base character.
//   5. Lengths after normalization: name 1–24, proclamation 0–140 (Unicode code points).

// C0/C1 controls (incl. tab/newline — whitespace is collapsed anyway), soft hyphen, Arabic letter
// mark, Hangul fillers, Mongolian vowel separator, zero-width space/non-joiner, LRM/RLM, bidi
// embeddings/overrides/isolates, word joiner and invisible operators, BOM, interlinear annotation.
const STRIP_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜ᅟᅠ᠎​‌‎‏‪-‮⁠-⁤⁦-⁩ㅤ﻿ﾠ￹-￻]/g;
// ZWJ is only meaningful inside emoji sequences; elsewhere it can hide text from term matching.
const STRAY_ZWJ_RE = /(?<!\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]?)‍|‍(?!\p{Extended_Pictographic})/gu;
// Tag characters are invisible ("ASCII smuggling"); keep them only inside a black-flag tag sequence.
const TAG_RE = /(\u{1F3F4}[\u{E0061}-\u{E007A}\u{E0030}-\u{E0039}]{2,7}\u{E007F})|[\u{E0000}-\u{E007F}]/gu;
const WHITESPACE_RE = /\s+/g;
const COMBINING_RUN_RE = /\p{M}{3,}/u;

export type TextField = "name" | "proclamation";

export interface TextLimits {
  nameMax: number;
  proclamationMax: number;
}

export const DEFAULT_TEXT_LIMITS: TextLimits = { nameMax: 24, proclamationMax: 140 };
export const NAME_MIN = 1;

/** NFC, strip invisible/control/bidi characters, collapse whitespace to single spaces, trim. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFC")
    .replace(STRIP_RE, "")
    .replace(TAG_RE, (m, flag: string | undefined) => flag ?? "")
    .replace(STRAY_ZWJ_RE, "")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

/** More than 2 combining marks on one base character ("Zalgo" text). */
export function hasCombiningAbuse(input: string): boolean {
  return COMBINING_RUN_RE.test(input);
}

/** Length in Unicode code points, as used for the name (1–24) and proclamation (0–140) limits. */
export function textLength(input: string): number {
  return Array.from(input).length;
}

export type NormalizeIssue = "empty" | "too_long" | "combining_marks";

export type NormalizedField =
  | { ok: true; field: TextField; text: string; length: number }
  | { ok: false; field: TextField; text: string; length: number; issue: NormalizeIssue; max: number };

/** Normalize one field and enforce its rules. `text` is the normalized text either way. */
export function normalizeField(field: TextField, input: string, limits: TextLimits = DEFAULT_TEXT_LIMITS): NormalizedField {
  const text = normalizeText(typeof input === "string" ? input : "");
  const length = textLength(text);
  const max = field === "name" ? limits.nameMax : limits.proclamationMax;
  const fail = (issue: NormalizeIssue): NormalizedField => ({ ok: false, field, text, length, issue, max });
  if (hasCombiningAbuse(text)) return fail("combining_marks");
  if (field === "name" && length < NAME_MIN) return fail("empty");
  if (length > max) return fail("too_long");
  return { ok: true, field, text, length };
}

export type NormalizedSubmission =
  | { ok: true; name: string; proclamation: string }
  | { ok: false; error: Extract<NormalizedField, { ok: false }> };

/** Normalize name and proclamation; the first failing field (name first) is returned. */
export function normalizeSubmission(
  input: { name: string; proclamation: string },
  limits: TextLimits = DEFAULT_TEXT_LIMITS,
): NormalizedSubmission {
  const name = normalizeField("name", input.name, limits);
  if (!name.ok) return { ok: false, error: name };
  const proclamation = normalizeField("proclamation", input.proclamation ?? "", limits);
  if (!proclamation.ok) return { ok: false, error: proclamation };
  return { ok: true, name: name.text, proclamation: proclamation.text };
}
