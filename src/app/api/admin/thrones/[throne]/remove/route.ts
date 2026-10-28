// OWNER: S. POST /api/admin/thrones/{throne}/remove body { reignId?, reasonCategory, notify? } — AD-02.
import { adminRoute } from "@/server/admin/route";
import { adminRemoveKing, isRemovalCategory } from "@/server/admin/ops";
import { HttpError, json, readJson } from "@/server/http";
import { isThroneId } from "@/server/throne/state";

export const POST = adminRoute(async (req, admin, ctx: { params: Promise<{ throne: string }> }) => {
  const { throne } = await ctx.params;
  if (!isThroneId(throne)) throw new HttpError(404, "not_found", "Unknown throne.");
  const body = await readJson<{ reignId?: unknown; reasonCategory?: unknown; notify?: unknown }>(req);
  if (!isRemovalCategory(body?.reasonCategory)) throw new HttpError(422, "validation", "Choose a reason category.");
  const reignId = typeof body.reignId === "string" ? body.reignId : undefined;
  const result = await adminRemoveKing(
    throne,
    { reignId, reasonCategory: body.reasonCategory, notify: body.notify === true },
    admin,
  );
  if (!result.removedReignId) throw new HttpError(409, "not_current", "That king is no longer on the throne.");
  return json(result);
});
