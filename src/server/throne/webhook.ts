// OWNER: C. Stripe webhook dispatch (PRD "Webhooks"). The route verifies the signature; this module
// makes processing idempotent by event id (stripe_events) and routes each event type.
// Payment events go to crown.ts (which is itself idempotent by reservation state); disputes and
// refunds go to S (src/server/disputes.ts).
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { now as clockNow } from "../clock";
import { getDb } from "../db/client";
import { stripeEvents } from "../db/schema";
import { handleChargeRefunded, handleDisputeClosed, handleDisputeCreated } from "../disputes";
import { handleAuthorized, handleIntentCanceled, handlePaymentFailed } from "./crown";

export async function processStripeEvent(event: Stripe.Event): Promise<{ duplicate: boolean; handled: boolean }> {
  const db = await getDb();
  const [seen] = await db.select().from(stripeEvents).where(eq(stripeEvents.eventId, event.id));
  if (seen) return { duplicate: true, handled: false };

  let handled = true;
  switch (event.type) {
    case "payment_intent.amount_capturable_updated":
    case "payment_intent.succeeded": {
      const outcome = await handleAuthorized(event.data.object.id);
      if (outcome.outcome !== "ignored") console.info("[webhook] crown", { eventId: event.id, ...outcome });
      break;
    }
    case "payment_intent.payment_failed":
      await handlePaymentFailed(event.data.object.id);
      break;
    case "payment_intent.canceled":
      await handleIntentCanceled(event.data.object.id);
      break;
    case "charge.refunded":
      await handleChargeRefunded(event);
      break;
    case "charge.dispute.created":
      await handleDisputeCreated(event);
      break;
    case "charge.dispute.closed":
      await handleDisputeClosed(event);
      break;
    default:
      handled = false;
  }

  // Recorded only after successful processing: a failure answers 500 and Stripe retries.
  await db.insert(stripeEvents).values({ eventId: event.id, type: event.type, processedAt: clockNow() }).onConflictDoNothing();
  return { duplicate: false, handled };
}
