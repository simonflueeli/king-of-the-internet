import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy";
import { createTestDb, setTestDb, type Database } from "../db/client";
import { bannedTerms, moderationChecks } from "../db/schema";
import { chooseClassifier, parseVerdict, setPolicyClassifier, type PolicyClassifier, type PolicyVerdict } from "./classifier";
import { moderateSubmission } from "./index";
import { findContactDetails } from "./patterns";
import { invalidateBannedTermsCache, matchBannedTerm, canonicalTerm } from "./terms";

const RES_ID = "11111111-1111-4111-8111-111111111111";

class FakeClassifier implements PolicyClassifier {
  readonly model = "fake-model-1";
  calls: { name: string; proclamation: string }[] = [];
  constructor(private impl: (input: { name: string; proclamation: string }, signal: AbortSignal) => Promise<PolicyVerdict>) {}
  classify(input: { name: string; proclamation: string }, signal: AbortSignal) {
    this.calls.push(input);
    return this.impl(input, signal);
  }
}

const allowAll = () => new FakeClassifier(async () => ({ decision: "allow" }));

let db: Database;

async function checks() {
  return db.select().from(moderationChecks).where(eq(moderationChecks.reservationId, RES_ID));
}

describe("moderateSubmission", () => {
  beforeEach(async () => {
    db = await createTestDb();
    setTestDb(db);
    invalidateBannedTermsCache();
    vi.stubEnv("MODERATION_LLM", "enabled");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  afterEach(() => {
    setPolicyClassifier(null);
    vi.unstubAllEnvs();
  });
  afterAll(() => setTestDb(null));

  it("allows clean text and returns normalized texts; both fields logged with the model", async () => {
    const fake = allowAll();
    setPolicyClassifier(fake);
    const r = await moderateSubmission({ reservationId: RES_ID, name: "  Max​ ", proclamation: "Bow   down 👑" });
    expect(r).toEqual({ ok: true, name: "Max", proclamation: "Bow down 👑" });
    expect(fake.calls).toEqual([{ name: "Max", proclamation: "Bow down 👑" }]);
    const rows = await checks();
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.result === "allow" && x.model === "fake-model-1" && x.latencyMs !== null)).toBe(true);
    expect(rows.find((x) => x.field === "name")).toMatchObject({ rawText: "  Max​ ", normalizedText: "Max" });
  });

  it("AC-14: a link in the name → 422 with the links message, no LLM call, check logged", async () => {
    const fake = allowAll();
    setPolicyClassifier(fake);
    const r = await moderateSubmission({ reservationId: RES_ID, name: "buy-now.com", proclamation: "" });
    expect(r).toEqual({
      ok: false,
      status: 422,
      field: "name",
      category: "links",
      message: copy.safety.moderation.links,
    });
    expect(fake.calls).toHaveLength(0);
    const name = (await checks()).find((x) => x.field === "name");
    expect(name).toMatchObject({ result: "deny", category: "links", normalizedText: "buy-now.com", model: "none" });
  });

  it("AC-14: a slur from the banned terms list → 422 banned_term (case/accent/spacing insensitive), logged", async () => {
    await db.insert(bannedTerms).values({ term: canonicalTerm("Vermin"), createdBy: "test" });
    setPolicyClassifier(allowAll());
    for (const name of ["VÉRMIN", "v e r m i n", "v3rmin king", "Vеrmin" /* Cyrillic е */]) {
      const r = await moderateSubmission({ reservationId: RES_ID, name, proclamation: "" });
      expect(r, name).toMatchObject({ ok: false, status: 422, field: "name", category: "banned_term" });
      if (!r.ok) expect(r.message).toBe(copy.safety.moderation.banned_term);
    }
    expect((await checks()).filter((x) => x.result === "deny" && x.category === "banned_term")).toHaveLength(4);
    // whole words only
    expect((await moderateSubmission({ reservationId: RES_ID, name: "Verminator", proclamation: "" })).ok).toBe(true);
  });

  it("AC-14: a slur caught by the policy classifier → 422 with the category message, never the model's text", async () => {
    setPolicyClassifier(new FakeClassifier(async () => ({ decision: "deny", category: "hate", field: "proclamation" })));
    const r = await moderateSubmission({ reservationId: RES_ID, name: "Max", proclamation: "some hateful text" });
    expect(r).toEqual({ ok: false, status: 422, field: "proclamation", category: "hate", message: copy.safety.moderation.hate });
    const rows = await checks();
    expect(rows.find((x) => x.field === "proclamation")).toMatchObject({ result: "deny", category: "hate", model: "fake-model-1" });
    expect(rows.find((x) => x.field === "name")).toMatchObject({ result: "allow" });
  });

  it("AC-15: classifier throws → 503 moderation unavailable, logged as error", async () => {
    setPolicyClassifier(new FakeClassifier(async () => Promise.reject(new Error("overloaded"))));
    const r = await moderateSubmission({ reservationId: RES_ID, name: "Max", proclamation: "" });
    expect(r).toEqual({
      ok: false,
      status: 503,
      field: null,
      category: "unavailable",
      message: copy.errModerationUnavailable,
    });
    expect((await checks()).every((x) => x.result === "error" && x.category === "unavailable")).toBe(true);
  });

  it("AC-15: classifier never answers → 503 after the 5 s timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let aborted = false;
      setPolicyClassifier(
        new FakeClassifier(
          (_i, signal) =>
            new Promise(() => {
              signal.addEventListener("abort", () => (aborted = true));
            }),
        ),
      );
      const pending = moderateSubmission({ reservationId: RES_ID, name: "Max", proclamation: "" });
      await vi.advanceTimersByTimeAsync(5_001);
      const r = await pending;
      expect(r).toMatchObject({ ok: false, status: 503 });
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("AC-15: no API key and the LLM not disabled → 503 (fail closed)", async () => {
    const r = await moderateSubmission({ reservationId: RES_ID, name: "Max", proclamation: "" });
    expect(r).toMatchObject({ ok: false, status: 503, category: "unavailable" });
  });

  it("MODERATION_LLM=disabled (development) skips only the LLM step and logs model none", async () => {
    vi.stubEnv("MODERATION_LLM", "disabled");
    expect((await moderateSubmission({ reservationId: RES_ID, name: "Max", proclamation: "" })).ok).toBe(true);
    expect((await checks()).every((x) => x.model === "none" && x.result === "allow")).toBe(true);
    // regex checks still run
    expect(await moderateSubmission({ reservationId: RES_ID, name: "Max", proclamation: "mail me max@example.com" })).toMatchObject({
      ok: false,
      field: "proclamation",
      category: "links",
    });
  });

  it("MODERATION_LLM=disabled is ignored in production", () => {
    expect(chooseClassifier({ NODE_ENV: "production", MODERATION_LLM: "disabled" } as NodeJS.ProcessEnv).kind).toBe("unavailable");
    expect(chooseClassifier({ NODE_ENV: "development", MODERATION_LLM: "disabled" } as NodeJS.ProcessEnv).kind).toBe("disabled");
  });

  it("rejects length and combining-mark violations with 422", async () => {
    setPolicyClassifier(allowAll());
    expect(await moderateSubmission({ reservationId: RES_ID, name: "", proclamation: "" })).toMatchObject({
      status: 422,
      field: "name",
      category: "empty",
      message: copy.safety.moderation.nameEmpty,
    });
    expect(await moderateSubmission({ reservationId: RES_ID, name: "x".repeat(25), proclamation: "" })).toMatchObject({
      status: 422,
      category: "too_long",
      message: "Names can be at most 24 characters.",
    });
    expect(await moderateSubmission({ reservationId: RES_ID, name: "Z̶̷̸", proclamation: "" })).toMatchObject({
      status: 422,
      category: "combining_marks",
    });
  });
});

describe("contact detail patterns", () => {
  it.each([
    "https://example.org",
    "www.example",
    "visit example.com today",
    "example .com",
    "example dot com",
    "example(dot)com",
    "ｅｘａｍｐｌｅ．ｃｏｍ",
    "max@example.com",
    "max (at) example (dot) com",
    "+41 79 123 45 67",
    "0041791234567",
    "(555) 123-4567 ext",
    "079 123 45 67",
    "t.me/channel",
  ])("flags %s", (text) => {
    expect(findContactDetails(text)).not.toBeNull();
  });

  it.each([
    "Max",
    "St.Louis",
    "J.R.R. Tolkien",
    "Hail the king. Me first",
    "Paid €1 000 000 for this",
    "Since 1999-2024",
    "Louis XIV",
    "Ruler of 28.10.2026",
    "Dr. Who",
    "I am at home",
  ])("allows %s", (text) => {
    expect(findContactDetails(text)).toBeNull();
  });
});

describe("banned term matching", () => {
  it("matches whole words after folding", () => {
    const terms = [canonicalTerm("bad word"), canonicalTerm("Vermin")];
    expect(matchBannedTerm("A BAD   WORD here", terms)).toBe("bad word");
    expect(matchBannedTerm("b.a.d w.o.r.d", terms)).toBe("bad word");
    expect(matchBannedTerm("verminous", terms)).toBeNull();
    expect(matchBannedTerm("", terms)).toBeNull();
  });
});

describe("parseVerdict", () => {
  it("parses allow and deny, maps unknown categories to other, rejects garbage", () => {
    expect(parseVerdict('{"decision":"allow","category":"none","field":"none"}')).toEqual({ decision: "allow" });
    expect(parseVerdict('{"decision":"deny","category":"spam","field":"name"}')).toEqual({
      decision: "deny",
      category: "spam",
      field: "name",
    });
    expect(parseVerdict('{"decision":"deny","category":"weird","field":"none"}')).toEqual({
      decision: "deny",
      category: "other",
      field: null,
    });
    expect(() => parseVerdict('{"decision":"maybe"}')).toThrow();
    expect(() => parseVerdict("not json")).toThrow();
  });
});
