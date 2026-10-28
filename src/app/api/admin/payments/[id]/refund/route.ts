// OWNER: S. POST /api/admin/payments/{id}/refund body { amountCents?, confirm: true } — AD-04.
// Full refund when amountCents is omitted. A refund of the current reign removes the king.
import { adminRoute } from "@/server/admin/route";
import { adminRefund } from "@/server/admin/ops";
import { HttpError, json, readJson } from "@/server/http";

export const POST = adminRoute(async (req, admin, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = await readJson<{ amountCents?: unknown; confirm?: unknown }>(req);
  if (body?.confirm !== true) throw new HttpError(422, "confirm", "Confirm the refund.");
  if (body.amountCents != null && typeof body.amountCents !== "number") throw new HttpError(422, "amount", "Invalid amount.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "not_found", "Payment not found.");
  return json(await adminRefund(id, (body.amountCents as number | undefined) ?? null, admin));
});
