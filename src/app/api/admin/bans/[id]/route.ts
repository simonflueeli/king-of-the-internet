// OWNER: S. DELETE /api/admin/bans/{id} — lift a ban (expires it now).
import { adminRoute } from "@/server/admin/route";
import { liftBan } from "@/server/bans";
import { HttpError, json } from "@/server/http";

export const DELETE = adminRoute(async (_req, admin, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await liftBan(id, admin.email))) {
    throw new HttpError(404, "not_found", "No active ban with that id.");
  }
  return json({ ok: true });
});
