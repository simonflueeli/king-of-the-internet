// OWNER: C. GET /api/reservations/{id} → ReservationStatus (polling fallback, no token needed).
// DELETE /api/reservations/{id} (X-Reservation-Token) → 204, releases the lock immediately.
import { assertOrigin, json, withErrors } from "@/server/http";
import { reservationToken } from "@/server/throne/api";
import { cancelReservation, getReservationStatus } from "@/server/throne/reservations";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrors(async (_req: Request, ctx: Ctx) => {
  return json(await getReservationStatus((await ctx.params).id));
});

export const DELETE = withErrors(async (req: Request, ctx: Ctx) => {
  assertOrigin(req);
  await cancelReservation((await ctx.params).id, reservationToken(req));
  return new Response(null, { status: 204 });
});
