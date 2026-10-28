// OWNER: C. POST /api/webhooks/stripe — signature verified, idempotent by event id. 400 bad signature.
import { apiError, json, withErrors } from "@/server/http";
import { verifyStripeWebhook } from "@/server/payments/stripe";
import { processStripeEvent } from "@/server/throne/webhook";

export const POST = withErrors(async (req: Request) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return apiError(400, "webhook_not_configured", "STRIPE_WEBHOOK_SECRET is not set.");
  const signature = req.headers.get("stripe-signature");
  if (!signature) return apiError(400, "bad_signature", "Missing Stripe-Signature header.");
  const raw = await req.text(); // the exact bytes Stripe signed
  let event;
  try {
    event = verifyStripeWebhook(raw, signature, secret);
  } catch {
    return apiError(400, "bad_signature", "Invalid Stripe signature.");
  }
  const result = await processStripeEvent(event);
  return json({ received: true, ...result });
});
