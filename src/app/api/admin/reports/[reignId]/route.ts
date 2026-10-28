// OWNER: S. POST /api/admin/reports/{reignId} body { action: "approve"|"remove", reasonCategory?, notify? } — AD-06.
import { adminRoute } from "@/server/admin/route";
import { isRemovalCategory } from "@/server/admin/ops";
import { HttpError, json, readJson } from "@/server/http";
import { decideReports } from "@/server/moderation/reports";

export const POST = adminRoute(async (req, admin, ctx: { params: Promise<{ reignId: string }> }) => {
  const { reignId } = await ctx.params;
  const body = await readJson<{ action?: unknown; reasonCategory?: unknown; notify?: unknown }>(req);
  if (body?.action !== "approve" && body?.action !== "remove") {
    throw new HttpError(422, "validation", "Choose approve or remove.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(reignId)) throw new HttpError(404, "not_found", "Reign not found.");
  const reasonCategory = isRemovalCategory(body.reasonCategory) ? body.reasonCategory : undefined;
  return json(await decideReports(reignId, body.action, admin.email, { reasonCategory, notify: body.notify === true }));
});
