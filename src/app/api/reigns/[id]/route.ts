// OWNER: C. GET /api/reigns/{id} → ReignDTO & { hidden } (hidden → name/proclamation blanked). 404.
import { copy } from "@/lib/copy";
import { HttpError, json, withErrors } from "@/server/http";
import { getReign } from "@/server/throne/state";

export const GET = withErrors(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const reign = await getReign((await ctx.params).id);
  if (!reign) throw new HttpError(404, "not_found", copy.core.errNotFound);
  return json(reign);
});
