// OWNER: C. POST /api/reservations/{id}/heartbeat (X-Reservation-Token) → ReservationStatus. 401 / 410.
import { assertOrigin, json, withErrors } from "@/server/http";
import { reservationToken } from "@/server/throne/api";
import { heartbeat } from "@/server/throne/reservations";

export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertOrigin(req);
  return json(await heartbeat((await ctx.params).id, reservationToken(req)));
});
