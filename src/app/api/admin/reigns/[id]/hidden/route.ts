// OWNER: S. POST /api/admin/reigns/{id}/hidden body { hidden } — AD-03 hide/unhide a reign.
import { adminRoute } from "@/server/admin/route";
import { adminSetHidden } from "@/server/admin/ops";
import { HttpError, json, readJson } from "@/server/http";

export const POST = adminRoute(async (req, admin, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = await readJson<{ hidden?: unknown }>(req);
  if (typeof body?.hidden !== "boolean") throw new HttpError(422, "validation", "hidden must be true or false.");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await adminSetHidden(id, body.hidden, admin))) {
    throw new HttpError(404, "not_found", "Reign not found.");
  }
  return json({ ok: true, hidden: body.hidden });
});
