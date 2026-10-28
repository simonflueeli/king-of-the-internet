// OWNER: C. POST /api/dev/fake-pay/{id} body { outcome: "succeed" | "decline" } (X-Reservation-Token)
// → ReservationStatus. Fake payment mode only (404 otherwise). Simulates the card authorization and
// then runs the same server code path as the Stripe webhook.
import { copy } from "@/lib/copy";
import { HttpError, assertOrigin, json, readJson, withErrors } from "@/server/http";
import { FakePaymentProvider } from "@/server/payments/fake";
import { getPaymentProvider } from "@/server/payments/provider";
import { reservationToken } from "@/server/throne/api";
import { handleAuthorized, handlePaymentFailed } from "@/server/throne/crown";
import { authorizeReservation, getReservationStatus } from "@/server/throne/reservations";

export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const provider = getPaymentProvider();
  if (!(provider instanceof FakePaymentProvider)) throw new HttpError(404, "not_found", copy.core.errNotFakeMode);
  assertOrigin(req);
  const { id } = await ctx.params;
  const r = await authorizeReservation(id, reservationToken(req));
  const body = (await readJson<{ outcome?: unknown }>(req)) ?? {};
  if (body.outcome !== "succeed" && body.outcome !== "decline") {
    throw new HttpError(400, "bad_request", copy.core.errBadRequest, { field: "outcome" });
  }
  if (!r.paymentIntentId) throw new HttpError(409, "payment_unavailable", copy.core.errPaymentUnavailable);

  if (body.outcome === "succeed") {
    try {
      provider.authorize(r.paymentIntentId);
    } catch {
      // Already cancelled / captured: the webhook path below sorts out what that means.
    }
    await handleAuthorized(r.paymentIntentId);
  } else {
    try {
      provider.decline(r.paymentIntentId);
    } catch {
      // nothing to decline any more
    }
    await handlePaymentFailed(r.paymentIntentId);
  }
  return json(await getReservationStatus(id));
});
