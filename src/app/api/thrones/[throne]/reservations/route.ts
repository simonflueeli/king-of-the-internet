// OWNER: C. POST /api/thrones/{throne}/reservations body { source? } → 201 CreateReservationResponse.
// 409 { error: "busy", lockedUntil } · 429 { error: "rate_limited" } · 403 { error: "banned" }
import type { ReservationSource } from "@/server/db/schema";
import { assertOrigin, json, withErrors } from "@/server/http";
import { requester, throneParam } from "@/server/throne/api";
import { RESERVATION_SOURCES, createReservation } from "@/server/throne/reservations";

export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ throne: string }> }) => {
  assertOrigin(req);
  const throne = throneParam((await ctx.params).throne);
  // The body is optional; anything unparsable means the default source.
  const body = (await req.json().catch(() => null)) as { source?: unknown } | null;
  const source = RESERVATION_SOURCES.find((s) => s === body?.source) ?? "button";
  return json(await createReservation(throne, requester(req), source satisfies ReservationSource), 201);
});
