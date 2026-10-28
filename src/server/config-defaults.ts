// OWNER: F. Configuration defaults (PRD "Configuration"). Seeded into the `config` table on first
// DB use; admins edit the table, getConfig() merges it over these defaults.

export interface AppConfig {
  currency: "EUR";
  baseCents: number;
  stepBps: number;
  decayBps: number;
  maxCents: number;
  nameMax: number;
  proclamationMax: number;
  reservationMs: number; // initial lock
  payingExtensionMs: number; // confirm extends the lock to now + this
  reservationMaxLifeMs: number; // hard cap on a reservation's total life
  heartbeatMs: number;
  heartbeatTimeoutMs: number; // released after this long without a heartbeat (unless paying)
  reconcileAfterMs: number; // paying for longer than this → reconcile with the provider
  rateLimitCount: number; // unpaid reservations per IP / device …
  rateLimitWindowMs: number; // … per window
  overthrowEmailWindowMs: number; // at most one overthrow email per recipient per throne per window
  reclaimTokenTtlMs: number;
  reportBlurThreshold: number; // reports from distinct IPs …
  reportBlurWindowMs: number; // … within this window blur the proclamation
  moderationRetentionDays: number;
}

export const CONFIG_DEFAULTS: AppConfig = {
  currency: "EUR",
  baseCents: 200,
  stepBps: 1000,
  decayBps: 200,
  maxCents: 100_000_000,
  nameMax: 24,
  proclamationMax: 140,
  reservationMs: 180_000,
  payingExtensionMs: 600_000,
  reservationMaxLifeMs: 780_000,
  heartbeatMs: 20_000,
  heartbeatTimeoutMs: 35_000,
  reconcileAfterMs: 120_000,
  rateLimitCount: 3,
  rateLimitWindowMs: 600_000,
  overthrowEmailWindowMs: 900_000,
  reclaimTokenTtlMs: 7 * 86_400_000,
  reportBlurThreshold: 3,
  reportBlurWindowMs: 600_000,
  moderationRetentionDays: 180,
};
