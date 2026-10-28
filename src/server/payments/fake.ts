// OWNER: F (skeleton), C (completes). In-process fake with Stripe-like PaymentIntent semantics
// (manual capture). No network. Authorizations are simulated with authorize()/decline(), which
// POST /api/dev/fake-pay/{id} calls before running the same code path as the Stripe webhook.
import { randomToken } from "../hash";
import type { IntentStatus, PaymentProvider } from "./provider";

export interface FakeIntent {
  id: string;
  clientSecret: string;
  amountCents: number;
  status: IntentStatus;
  amountCapturable: number;
  metadata: Record<string, string>;
  chargeId: string | null;
  refundedCents: number;
  captureKeys: Set<string>;
  lastError: string | null;
}

export class FakePaymentProvider implements PaymentProvider {
  readonly mode = "fake" as const;
  readonly intents = new Map<string, FakeIntent>();

  private get(id: string): FakeIntent {
    const intent = this.intents.get(id) ?? [...this.intents.values()].find((i) => i.chargeId === id);
    if (!intent) throw new Error(`fake payment intent not found: ${id}`);
    return intent;
  }

  /** The intent created for a reservation (tests, dev tooling). */
  forReservation(reservationId: string): FakeIntent | undefined {
    return [...this.intents.values()].find((i) => i.metadata.reservationId === reservationId);
  }

  async createIntent(p: { amountCents: number; reservationId: string; throne: string }) {
    // Same reservation → same intent, like Stripe's `create-${reservationId}` idempotency key.
    const existing = this.forReservation(p.reservationId);
    if (existing) return { id: existing.id, clientSecret: existing.clientSecret };
    const id = `fake_pi_${randomToken(12)}`;
    const clientSecret = `fake_${id}_secret_${randomToken(12)}`;
    this.intents.set(id, {
      id,
      clientSecret,
      amountCents: p.amountCents,
      status: "requires_payment_method",
      amountCapturable: 0,
      metadata: { reservationId: p.reservationId, throne: p.throne },
      chargeId: null,
      refundedCents: 0,
      captureKeys: new Set(),
      lastError: null,
    });
    return { id, clientSecret };
  }

  async updateAmount(id: string, amountCents: number, meta?: Record<string, string>) {
    const intent = this.get(id);
    if (intent.status === "requires_capture" || intent.status === "succeeded" || intent.status === "canceled") {
      throw new Error(`cannot update amount of a ${intent.status} intent`);
    }
    intent.amountCents = amountCents;
    if (meta) Object.assign(intent.metadata, meta);
  }

  /** Simulate a successful card authorization (Stripe: payment_intent.amount_capturable_updated). */
  authorize(id: string): FakeIntent {
    const intent = this.get(id);
    if (intent.status === "canceled" || intent.status === "succeeded") {
      throw new Error(`cannot authorize a ${intent.status} intent`);
    }
    intent.status = "requires_capture";
    intent.amountCapturable = intent.amountCents;
    intent.lastError = null;
    return intent;
  }

  /** Simulate a declined card (Stripe: payment_intent.payment_failed). The intent stays usable. */
  decline(id: string, message = "Your card was declined."): FakeIntent {
    const intent = this.get(id);
    if (intent.status === "canceled" || intent.status === "succeeded") {
      throw new Error(`cannot decline a ${intent.status} intent`);
    }
    intent.status = "requires_payment_method";
    intent.amountCapturable = 0;
    intent.lastError = message;
    return intent;
  }

  async capture(id: string, idempotencyKey: string) {
    const intent = this.get(id);
    if (intent.status === "succeeded" && intent.captureKeys.has(idempotencyKey)) {
      return { chargeId: intent.chargeId, feeCents: fakeFee(intent.amountCents), cardFingerprint: "fake_fp_4242" };
    }
    if (intent.status !== "requires_capture") throw new Error(`cannot capture a ${intent.status} intent`);
    intent.status = "succeeded";
    intent.amountCapturable = 0;
    intent.chargeId = `fake_ch_${randomToken(12)}`;
    intent.captureKeys.add(idempotencyKey);
    return { chargeId: intent.chargeId, feeCents: fakeFee(intent.amountCents), cardFingerprint: "fake_fp_4242" };
  }

  async cancel(id: string) {
    const intent = this.get(id);
    if (intent.status === "canceled") return;
    if (intent.status === "succeeded") throw new Error("cannot cancel a succeeded intent");
    intent.status = "canceled";
    intent.amountCapturable = 0;
  }

  async retrieve(id: string) {
    const intent = this.get(id);
    return { status: intent.status, amountCapturable: intent.amountCapturable };
  }

  async refund(chargeOrIntentId: string, amountCents?: number) {
    const intent = this.get(chargeOrIntentId);
    if (intent.status !== "succeeded") throw new Error(`cannot refund a ${intent.status} intent`);
    const remaining = intent.amountCents - intent.refundedCents;
    const amount = amountCents ?? remaining;
    if (amount <= 0 || amount > remaining) throw new Error("refund amount exceeds the captured amount");
    intent.refundedCents += amount;
  }
}

/** Roughly Stripe's EEA card pricing (1.5% + €0.25), so fee reporting has numbers in dev. */
function fakeFee(amountCents: number): number {
  return Math.round(amountCents * 0.015) + 25;
}
