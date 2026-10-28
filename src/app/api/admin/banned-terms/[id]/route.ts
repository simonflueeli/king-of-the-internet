// OWNER: S. DELETE /api/admin/banned-terms/{id} — AD-08.
import { adminRoute } from "@/server/admin/route";
import { HttpError, json } from "@/server/http";
import { removeBannedTerm } from "@/server/moderation/terms";

export const DELETE = adminRoute(async (_req, admin, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await removeBannedTerm(id, admin.email))) {
    throw new HttpError(404, "not_found", "Term not found.");
  }
  return json({ ok: true });
});
