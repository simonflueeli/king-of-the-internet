// OWNER: F (skeleton), C (completes). Stripe PaymentIntents with capture_method=manual: the card is
// authorized first and captured only for a valid reservation (src/server/throne/crown.ts).
//
// Payment methods: automatic payment methods with allow_redirects "never". With manual capture
// that leaves cards and the wallets that ride on cards (Apple Pay, Google Pay, Link) — all support
// separate authorization and capture, and none needs a return_url. 3-D Secure still runs in place
// in the Payment Element; the client calls stripe.confirmPayment({ elements, redirect: "if_required" }).
//
// Not verified against Stripe test mode in this repo (no keys in CI) — type-checked and reviewed only.
import Stripe from "stripe";
import type { ThroneId } from "@/lib/contracts";
import type { IntentStatus, PaymentProvider } from "./provider";

const INTENT_STATUSES: readonly IntentStatus[] = [
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "requires_capture",
  "succeeded",
  "canceled",
  "processing",
];

function toIntentStatus(s: string): IntentStatus {
  if ((INTENT_STATUSES as readonly string[]).includes(s)) return s as IntentStatus;
  throw new Error(`unexpected PaymentIntent status ${s}`);
}

export class StripePaymentProvider implements PaymentProvider {
  readonly mode = "stripe" as const;
  readonly stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, {
      maxNetworkRetries: 2,
      timeout: 10_000,
      appInfo: { name: "the-throne" },
    });
  }

  async createIntent(p: { amountCents: number; reservationId: string; throne: ThroneId }) {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: p.amountCents,
        currency: "eur",
        capture_method: "manual",
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        description: p.throne === "daily" ? "The Throne: Daily Throne" : "The Throne: Eternal Throne",
        metadata: { reservationId: p.reservationId, throne: p.throne },
      },
      { idempotencyKey: `create-${p.reservationId}` },
    );
    if (!intent.client_secret) throw new Error(`PaymentIntent ${intent.id} has no client secret`);
    return { id: intent.id, clientSecret: intent.client_secret };
  }

  async updateAmount(id: string, amountCents: number, meta?: Record<string, string>) {
    // Allowed while the intent awaits a payment method / confirmation; Stripe rejects it once
    // authorized, which the caller turns into an error before the reservation moves to paying.
    await this.stripe.paymentIntents.update(id, { amount: amountCents, ...(meta ? { metadata: meta } : {}) });
  }

  async capture(id: string, idempotencyKey: string) {
    const intent = await this.stripe.paymentIntents.capture(
      id,
      { expand: ["latest_charge.balance_transaction"] },
      { idempotencyKey: `capture-${idempotencyKey}` },
    );
    if (intent.status !== "succeeded") throw new Error(`capture left PaymentIntent ${id} in ${intent.status}`);
    const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    const bt = charge && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
    return {
      chargeId: charge?.id ?? (typeof intent.latest_charge === "string" ? intent.latest_charge : null),
      feeCents: bt?.fee ?? null,
      cardFingerprint: charge?.payment_method_details?.card?.fingerprint ?? null,
    };
  }

  async cancel(id: string) {
    try {
      await this.stripe.paymentIntents.cancel(id, { cancellation_reason: "abandoned" });
    } catch (err) {
      // Cancelling twice is a no-op for us; anything else (e.g. already captured) is a real error.
      const current = await this.stripe.paymentIntents.retrieve(id).catch(() => null);
      if (current?.status === "canceled") return;
      throw err;
    }
  }

  async retrieve(id: string) {
    const intent = await this.stripe.paymentIntents.retrieve(id);
    return { status: toIntentStatus(intent.status), amountCapturable: intent.amount_capturable };
  }

  async refund(chargeOrIntentId: string, amountCents?: number) {
    const target = chargeOrIntentId.startsWith("pi_") ? { payment_intent: chargeOrIntentId } : { charge: chargeOrIntentId };
    await this.stripe.refunds.create({ ...target, ...(amountCents != null ? { amount: amountCents } : {}) });
  }
}

/**
 * Verify a webhook delivery (raw body + Stripe-Signature header) and parse the event. Throws on a
 * bad signature. Needs only the endpoint secret, not an API key.
 */
export function verifyStripeWebhook(rawBody: string, signature: string, secret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(rawBody, signature, secret);
}
