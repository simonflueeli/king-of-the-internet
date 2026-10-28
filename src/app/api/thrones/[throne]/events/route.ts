// OWNER: C. GET /api/thrones/{throne}/events?reservationId=&token= → SSE stream of ThroneEvent.
import { withErrors } from "@/server/http";
import { throneParam } from "@/server/throne/api";
import { verifyReservationToken } from "@/server/throne/reservations";
import { SSE_HEADERS, openThroneStream } from "@/server/throne/sse";

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ throne: string }> }) => {
  const throne = throneParam((await ctx.params).throne);
  const q = new URL(req.url).searchParams;
  const reservationId = q.get("reservationId");
  const token = q.get("token");
  // An invalid or foreign reservation simply gets the public stream (no private results).
  let reservation = reservationId && token ? await verifyReservationToken(reservationId, token) : null;
  if (reservation && reservation.throneId !== throne) reservation = null;
  return new Response(openThroneStream(throne, { signal: req.signal, reservation }), { headers: SSE_HEADERS });
});
