// OWNER: S. Admin-editable banned terms (PRD "Banned terms list"), matched case- and
// accent-insensitively on word boundaries. Spaced-out spellings ("s l u r", "s.l.u.r") and common
// digit substitutions ("5lur") are folded before matching.
import { asc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { auditLog, bannedTerms } from "../db/schema";
import { foldForChecks } from "./patterns";

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };

/** Words of the folded text, with runs of single characters joined ("s l u r" → "slur"). */
function words(folded: string): string[] {
  const tokens = folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out: string[] = [];
  let run = "";
  for (const t of tokens) {
    if (Array.from(t).length === 1) {
      run += t;
      continue;
    }
    if (run) out.push(run);
    run = "";
    out.push(t);
  }
  if (run) out.push(run);
  return out;
}

/** Match keys for a text: plain folded words and a digit/symbol-substituted variant. */
export function termKeys(text: string): string[] {
  const folded = foldForChecks(text);
  const leet = folded.replace(/[013457@$!]/g, (c) => LEET[c] ?? c);
  const keys = new Set([` ${words(folded).join(" ")} `, ` ${words(leet).join(" ")} `]);
  return [...keys];
}

/** Canonical form a term is stored and compared in. */
export function canonicalTerm(term: string): string {
  return words(foldForChecks(term)).join(" ");
}

/** The first banned term contained in `text` (whole words), or null. */
export function matchBannedTerm(text: string, terms: readonly string[]): string | null {
  if (!terms.length) return null;
  const keys = termKeys(text);
  for (const term of terms) {
    if (!term) continue;
    // multi-word terms also match written together or spelled out ("b a d w o r d" → "badword")
    const needles = [` ${term} `, ` ${term.replace(/ /g, "")} `];
    if (keys.some((k) => needles.some((n) => k.includes(n)))) return term;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Storage (cached 30 s like config; admin edits invalidate)
// ---------------------------------------------------------------------------------------------

const CACHE_MS = 30_000;
const g = globalThis as unknown as { __ktiTermsCache?: { terms: string[]; loadedAt: number } | null };

export function invalidateBannedTermsCache(): void {
  g.__ktiTermsCache = null;
}

/** Canonical banned terms for matching. */
export async function getBannedTerms(): Promise<string[]> {
  const cached = g.__ktiTermsCache;
  if (cached && Date.now() - cached.loadedAt < CACHE_MS) return cached.terms;
  const db = await getDb();
  const rows = await db.select({ term: bannedTerms.term }).from(bannedTerms);
  const terms = [...new Set(rows.map((r) => canonicalTerm(r.term)).filter(Boolean))];
  g.__ktiTermsCache = { terms, loadedAt: Date.now() };
  return terms;
}

export async function listBannedTerms() {
  const db = await getDb();
  return db.select().from(bannedTerms).orderBy(asc(bannedTerms.term));
}

/** Adds a term (stored in canonical form). Returns null when it folds to nothing. */
export async function addBannedTerm(term: string, actor: string) {
  const canonical = canonicalTerm(term);
  if (!canonical) return null;
  const db = await getDb();
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(bannedTerms)
      .values({ term: canonical, createdBy: actor })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      await tx.insert(auditLog).values({ actor, action: "terms.add", target: inserted.id, after: { term: canonical } });
    }
    return inserted ?? null;
  });
  invalidateBannedTermsCache();
  return row;
}

export async function removeBannedTerm(id: string, actor: string): Promise<boolean> {
  const db = await getDb();
  const removed = await db.transaction(async (tx) => {
    const [row] = await tx.delete(bannedTerms).where(eq(bannedTerms.id, id)).returning();
    if (row) await tx.insert(auditLog).values({ actor, action: "terms.remove", target: id, before: { term: row.term } });
    return !!row;
  });
  invalidateBannedTermsCache();
  return removed;
}
