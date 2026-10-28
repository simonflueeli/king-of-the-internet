// OWNER: C. POST /api/reservations/{id}/confirm (X-Reservation-Token) body ConfirmReservationRequest
// → ReservationStatus (state "paying"). 410 · 422 amount|validation|moderation · 503 · 403.
import { assertOrigin, json, readJson, withErrors } from "@/server/http";
import { requester, reservationToken } from "@/server/throne/api";
import { confirmReservation, parseConfirmBody } from "@/server/throne/reservations";

export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertOrigin(req);
  const body = parseConfirmBody(await readJson(req));
  return json(await confirmReservation((await ctx.params).id, reservationToken(req), body, requester(req)));
});
