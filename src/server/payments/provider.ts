// OWNER: F (interface), C (implementations). Card payments with manual capture.
import type { PaymentMode, ThroneId } from "@/lib/contracts";
import { FakePaymentProvider } from "./fake";
import { StripePaymentProvider } from "./stripe";

export type IntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "requires_capture"
  | "succeeded"
  | "canceled"
  | "processing";

export interface PaymentProvider {
  mode: PaymentMode;
  createIntent(p: { amountCents: number; reservationId: string; throne: ThroneId }): Promise<{ id: string; clientSecret: string }>;
  updateAmount(id: string, amountCents: number, meta?: Record<string, string>): Promise<void>;
  capture(id: string, idempotencyKey: string): Promise<{ chargeId: string | null; feeCents: number | null; cardFingerprint: string | null }>;
  cancel(id: string): Promise<void>;
  retrieve(id: string): Promise<{ status: IntentStatus; amountCapturable: number }>;
  refund(chargeOrIntentId: string, amountCents?: number): Promise<void>;
}

export function paymentMode(): PaymentMode {
  return process.env.STRIPE_SECRET_KEY ? "stripe" : "fake";
}

const g = globalThis as unknown as { __ktiPayments?: PaymentProvider };

/** Stripe when STRIPE_SECRET_KEY is set, otherwise the in-process fake. Singleton. */
export function getPaymentProvider(): PaymentProvider {
  const mode = paymentMode();
  if (!g.__ktiPayments || g.__ktiPayments.mode !== mode) {
    g.__ktiPayments =
      mode === "stripe" ? new StripePaymentProvider(process.env.STRIPE_SECRET_KEY!) : new FakePaymentProvider();
  }
  return g.__ktiPayments;
}

/** Test helper: replace the provider (e.g. a fresh FakePaymentProvider per test). */
export function setPaymentProvider(provider: PaymentProvider | null): void {
  g.__ktiPayments = provider ?? undefined;
}
