// OWNER: F (skeleton), C (completes and verifies against Stripe test mode).
// PaymentIntents with capture_method=manual: authorize first, capture only for a valid reservation.
import Stripe from "stripe";
import type { ThroneId } from "@/lib/contracts";
import type { IntentStatus, PaymentProvider } from "./provider";

export class StripePaymentProvider implements PaymentProvider {
  readonly mode = "stripe" as const;
  readonly stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 10_000 });
  }

  async createIntent(p: { amountCents: number; reservationId: string; throne: ThroneId }) {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: p.amountCents,
        currency: "eur",
        capture_method: "manual",
        automatic_payment_methods: { enabled: true },
        metadata: { reservationId: p.reservationId, throne: p.throne },
      },
      { idempotencyKey: `create-${p.reservationId}` },
    );
    return { id: intent.id, clientSecret: intent.client_secret! };
  }

  async updateAmount(id: string, amountCents: number, meta?: Record<string, string>) {
    await this.stripe.paymentIntents.update(id, { amount: amountCents, ...(meta ? { metadata: meta } : {}) });
  }

  async capture(id: string, idempotencyKey: string) {
    const intent = await this.stripe.paymentIntents.capture(
      id,
      { expand: ["latest_charge.balance_transaction"] },
      { idempotencyKey: `capture-${idempotencyKey}` },
    );
    const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    const bt = charge && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
    return {
      chargeId: charge?.id ?? (typeof intent.latest_charge === "string" ? intent.latest_charge : null),
      feeCents: bt?.fee ?? null,
      cardFingerprint: charge?.payment_method_details?.card?.fingerprint ?? null,
    };
  }

  async cancel(id: string) {
    await this.stripe.paymentIntents.cancel(id);
  }

  async retrieve(id: string) {
    const intent = await this.stripe.paymentIntents.retrieve(id);
    return { status: intent.status as IntentStatus, amountCapturable: intent.amount_capturable };
  }

  async refund(chargeOrIntentId: string, amountCents?: number) {
    const target = chargeOrIntentId.startsWith("pi_") ? { payment_intent: chargeOrIntentId } : { charge: chargeOrIntentId };
    await this.stripe.refunds.create({ ...target, ...(amountCents != null ? { amount: amountCents } : {}) });
  }
}
