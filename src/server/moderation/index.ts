// OWNER: S. Moderation of everything shown on the throne (PRD "Moderation, abuse and admin").
// Pipeline per submission: normalize → length/combining rules → links & contact details (regex) →
// banned terms → LLM policy check. Fails closed: if the LLM check cannot run, 503 and nobody buys.
// Every submission writes one moderation_checks row per field.
//
// Call outside any DB transaction (it reads config/banned terms and writes audit rows via getDb()).
import { normalizeField, type NormalizedField, type TextField } from "@/lib/normalize";
import { getConfig } from "../config";
import { getDb } from "../db/client";
import { moderationChecks, type ModerationResult } from "../db/schema";
import { messageFor, type ModerationCategory } from "./categories";
import { chooseClassifier, MODERATION_MODEL, MODERATION_TIMEOUT_MS, type PolicyVerdict } from "./classifier";
import { findContactDetails } from "./patterns";
import { getBannedTerms, matchBannedTerm } from "./terms";

export { setPolicyClassifier, type PolicyClassifier, type PolicyVerdict } from "./classifier";
export type { ModerationCategory } from "./categories";

export type ModerationOutcome =
  | { ok: true; name: string; proclamation: string }            // normalized texts to store/display
  | { ok: false; status: 422 | 503; field: "name" | "proclamation" | null; category: string; message: string };

interface CheckRow {
  field: TextField;
  rawText: string;
  normalizedText: string;
  result: ModerationResult;
  category: string | null;
  model: string;
  latencyMs: number | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deterministic checks for one normalized field: rules, contact details, banned terms. */
function staticCheck(f: NormalizedField, terms: readonly string[]): { category: ModerationCategory; max?: number } | null {
  if (!f.ok) return { category: f.issue, max: f.max };
  if (!f.text) return null;
  if (findContactDetails(f.text)) return { category: "links" };
  if (matchBannedTerm(f.text, terms)) return { category: "banned_term" };
  return null;
}

/** Runs the classifier with a hard deadline, independent of whether it honours the signal. */
async function classifyWithDeadline(
  classify: (signal: AbortSignal) => Promise<PolicyVerdict>,
  ms: number,
): Promise<PolicyVerdict> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error(`moderation timed out after ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([classify(ctrl.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

let warnedDisabled = false;

export async function moderateSubmission(input: {
  reservationId: string;
  name: string;
  proclamation: string;
}): Promise<ModerationOutcome> {
  const cfg = await getConfig();
  const limits = { nameMax: cfg.nameMax, proclamationMax: cfg.proclamationMax };
  const raw = { name: String(input.name ?? ""), proclamation: String(input.proclamation ?? "") };
  const fields = [normalizeField("name", raw.name, limits), normalizeField("proclamation", raw.proclamation, limits)];
  const rows: CheckRow[] = fields.map((f) => ({
    field: f.field,
    rawText: raw[f.field],
    normalizedText: f.text,
    result: "allow",
    category: null,
    model: "none",
    latencyMs: null,
  }));

  const outcome = await decide(fields, rows);

  const db = await getDb();
  await db.insert(moderationChecks).values(
    rows.map((r) => ({ ...r, reservationId: UUID_RE.test(input.reservationId) ? input.reservationId : null })),
  );
  return outcome;
}

async function decide(fields: NormalizedField[], rows: CheckRow[]): Promise<ModerationOutcome> {
  // 1–3. Rules, contact details, banned terms (both fields, so each row records its own result).
  const terms = await getBannedTerms();
  let firstFailure: { field: TextField; category: ModerationCategory; max?: number } | null = null;
  for (const [i, f] of fields.entries()) {
    const failure = staticCheck(f, terms);
    if (!failure) continue;
    rows[i].result = "deny";
    rows[i].category = failure.category;
    firstFailure ??= { field: f.field, ...failure };
  }
  if (firstFailure) {
    const { field, category, max } = firstFailure;
    return { ok: false, status: 422, field, category, message: messageFor(category, field, max) };
  }

  const name = fields[0].text;
  const proclamation = fields[1].text;

  // 4. LLM policy check.
  const choice = chooseClassifier();
  if (choice.kind === "disabled") {
    if (!warnedDisabled) {
      warnedDisabled = true;
      console.warn("[moderation] MODERATION_LLM=disabled: policy check skipped (development only)");
    }
    return { ok: true, name, proclamation };
  }
  if (choice.kind === "unavailable") {
    console.error("[moderation] policy check unavailable", { reason: choice.reason });
    return unavailable(rows, MODERATION_MODEL, null);
  }

  const { classifier } = choice;
  const started = Date.now();
  let verdict: PolicyVerdict;
  try {
    verdict = await classifyWithDeadline((signal) => classifier.classify({ name, proclamation }, signal), MODERATION_TIMEOUT_MS);
  } catch (err) {
    const latency = Date.now() - started;
    console.error("[moderation] policy check failed", { model: classifier.model, latencyMs: latency, err: String(err) });
    return unavailable(rows, classifier.model, latency);
  }
  const latencyMs = Date.now() - started;
  for (const r of rows) Object.assign(r, { model: classifier.model, latencyMs });

  if (verdict.decision === "allow") return { ok: true, name, proclamation };

  // An empty proclamation cannot be the problem, whatever the model says.
  const field = verdict.field ?? (proclamation ? null : "name");
  for (const r of rows) {
    if (field === null || r.field === field) Object.assign(r, { result: "deny", category: verdict.category });
  }
  return { ok: false, status: 422, field, category: verdict.category, message: messageFor(verdict.category, field) };
}

function unavailable(rows: CheckRow[], model: string, latencyMs: number | null): ModerationOutcome {
  for (const r of rows) Object.assign(r, { result: "error", category: "unavailable", model, latencyMs });
  return { ok: false, status: 503, field: null, category: "unavailable", message: messageFor("unavailable", null) };
}
