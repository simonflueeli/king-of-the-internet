// OWNER: S. Moderation categories and their user-facing messages.
import { copy, fill } from "@/lib/copy";
import type { NormalizeIssue, TextField } from "@/lib/normalize";

/** LLM policy categories (PRD "Policy categories to deny"). */
export const POLICY_CATEGORIES = [
  "hate",
  "harassment",
  "sexual",
  "violence",
  "self_harm",
  "impersonation",
  "spam",
  "personal_data",
] as const;
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

/**
 * Every `category` moderateSubmission can return:
 *   links | banned_term | <PolicyCategory> | other | empty | too_long | combining_marks | unavailable
 */
export type ModerationCategory = "links" | "banned_term" | PolicyCategory | "other" | NormalizeIssue | "unavailable";

export function isPolicyCategory(v: unknown): v is PolicyCategory {
  return typeof v === "string" && (POLICY_CATEGORIES as readonly string[]).includes(v);
}

export function messageFor(category: ModerationCategory, field: TextField | null, max?: number): string {
  const m = copy.safety.moderation;
  switch (category) {
    case "empty":
      return m.nameEmpty;
    case "too_long":
      return fill(field === "name" ? m.nameTooLong : m.proclamationTooLong, { max: max ?? "" });
    case "combining_marks":
      return m.combiningMarks;
    case "unavailable":
      return copy.errModerationUnavailable;
    default:
      return m[category];
  }
}
