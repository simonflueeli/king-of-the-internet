// OWNER: S. Stub shipped by F: logs only. Called by C's Stripe webhook route.
import type { Stripe } from "stripe";

export async function handleDisputeCreated(event: Stripe.Event): Promise<void> {
  console.info("[disputes] stub: charge.dispute.created", event.id);
}

export async function handleDisputeClosed(event: Stripe.Event): Promise<void> {
  console.info("[disputes] stub: charge.dispute.closed", event.id);
}

export async function handleChargeRefunded(event: Stripe.Event): Promise<void> {
  console.info("[disputes] stub: charge.refunded", event.id);
}
