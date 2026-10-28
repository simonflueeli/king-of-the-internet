// OWNER: S. Stub shipped by F: normalizes and allows everything. S replaces the body with regex,
// banned-terms and LLM checks (and logs every check to moderation_checks).
import { normalizeText } from "@/lib/normalize";

export type ModerationOutcome =
  | { ok: true; name: string; proclamation: string }            // normalized texts to store/display
  | { ok: false; status: 422 | 503; field: "name" | "proclamation" | null; category: string; message: string };

export async function moderateSubmission(input: {
  reservationId: string;
  name: string;
  proclamation: string;
}): Promise<ModerationOutcome> {
  return { ok: true, name: normalizeText(input.name), proclamation: normalizeText(input.proclamation) };
}
