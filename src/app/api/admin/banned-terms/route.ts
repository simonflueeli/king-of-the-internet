// OWNER: S. GET /api/admin/banned-terms, POST body { term } — AD-08.
import { adminRoute } from "@/server/admin/route";
import { HttpError, json, readJson } from "@/server/http";
import { addBannedTerm, listBannedTerms } from "@/server/moderation/terms";

export const GET = adminRoute(async () => json({ terms: await listBannedTerms() }));

export const POST = adminRoute(async (req, admin) => {
  const body = await readJson<{ term?: unknown }>(req);
  if (typeof body?.term !== "string" || body.term.length > 100) throw new HttpError(422, "validation", "Enter a term.");
  const row = await addBannedTerm(body.term, admin.email);
  if (!row) throw new HttpError(422, "validation", "That term is empty or already on the list.");
  return json({ term: row }, 201);
});
