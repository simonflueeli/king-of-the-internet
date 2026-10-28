// OWNER: C. GET /api/config/public → PublicConfig.
import type { PublicConfig } from "@/lib/contracts";
import { getConfig } from "@/server/config";
import { json, withErrors } from "@/server/http";
import { paymentMode } from "@/server/payments/provider";

export const GET = withErrors(async () => {
  const cfg = await getConfig();
  const mode = paymentMode();
  const body: PublicConfig = {
    currency: cfg.currency,
    baseCents: cfg.baseCents,
    stepBps: cfg.stepBps,
    decayBps: cfg.decayBps,
    maxCents: cfg.maxCents,
    nameMax: cfg.nameMax,
    proclamationMax: cfg.proclamationMax,
    reservationMs: cfg.reservationMs,
    heartbeatMs: cfg.heartbeatMs,
    paymentMode: mode,
    stripePublishableKey: mode === "stripe" ? process.env.STRIPE_PUBLISHABLE_KEY || null : null,
  };
  return json(body);
});
