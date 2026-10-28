// OWNER: F. Other workstreams may append tables/columns only inside a clearly delimited section
// headed with their workstream letter (see docs/ARCHITECTURE.md "Schema changes").
//
// Conventions: money in integer cents, times as timestamptz (UTC), ids as UUIDs (except thrones,
// config keys, WebAuthn credential ids and stripe event ids). Enum-like columns are plain text typed
// with the unions from src/lib/contracts.ts so adding a value never needs a migration.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { EndReason, FailReason, ReservationState, ThroneId, Title } from "@/lib/contracts";

const ts = () => timestamp({ withTimezone: true, mode: "date" });
const createdAt = () => ts().notNull().defaultNow();

export type ReservationSource = "button" | "tryon" | "reclaim";
export type BanKind = "email" | "card" | "ip" | "device";
export type ReportReason = "offensive" | "impersonation" | "spam" | "other";
export type ReportStatus = "pending" | "approved" | "removed";
export type ModerationField = "name" | "proclamation";
export type ModerationResult = "allow" | "deny" | "error";

// ---------------------------------------------------------------------------------------------
// Thrones, reigns, reservations, payments
// ---------------------------------------------------------------------------------------------

/** One row per throne. Locked with SELECT … FOR UPDATE for every state change on that throne. */
export const thrones = pgTable("thrones", {
  id: text().$type<ThroneId>().primaryKey(),
  currentReignId: uuid(), // null = vacant
  lastPaidCents: integer(), // P in the pricing formula; unchanged by an admin removal
  crownedAt: ts(), // time of the last takeover (drives decay / daily reset)
  removedAt: ts(), // set when the last king was removed by an admin (vacancy reason "removed")
  version: integer().notNull().default(0),
  updatedAt: ts().notNull().defaultNow(),
});

export const customers = pgTable("customers", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(), // normalized: trimmed + lowercased
  createdAt: createdAt(),
  alertOptIn: boolean().notNull().default(false),
  alertOptInAt: ts(), // consent timestamp
  unsubscribedAt: ts(),
});

export const reigns = pgTable(
  "reigns",
  {
    id: uuid().primaryKey().defaultRandom(),
    throneId: text().$type<ThroneId>().notNull().references(() => thrones.id),
    customerId: uuid().references(() => customers.id),
    name: text().notNull(),
    proclamation: text(), // null when empty
    paidCents: integer().notNull(),
    title: text().$type<Title>().notNull(), // stored at creation
    crestSeed: bigint({ mode: "number" }).notNull(), // 32-bit FNV-1a of the lowercased name
    startedAt: ts().notNull(),
    endedAt: ts(),
    endReason: text().$type<EndReason>(),
    hidden: boolean().notNull().default(false),
    blurred: boolean().notNull().default(false), // 3+ reports pending
    disputed: boolean().notNull().default(false), // a chargeback was opened on its payment (current or ended reign)
    paymentId: uuid().references(() => payments.id),
    createdAt: createdAt(),
  },
  (t) => [index("reigns_throne_started_idx").on(t.throneId, t.startedAt.desc())],
);

export const reservations = pgTable(
  "reservations",
  {
    id: uuid().primaryKey().defaultRandom(),
    throneId: text().$type<ThroneId>().notNull().references(() => thrones.id),
    minCents: integer().notNull(), // locked minimum
    amountCents: integer(), // set at confirm
    throneVersion: integer().notNull(),
    state: text().$type<ReservationState>().notNull().default("active"),
    failReason: text().$type<FailReason>(),
    expiresAt: ts().notNull(),
    lastHeartbeatAt: ts().notNull().defaultNow(),
    payingAt: ts(), // when confirm moved it to "paying" (reconcile job: stuck > 2 min)
    clientIpHash: text(),
    deviceId: text(),
    reservationTokenHash: text().notNull(),
    source: text().$type<ReservationSource>().notNull().default("button"),
    paymentIntentId: text(),
    name: text(),
    proclamation: text(),
    email: text(),
    alertOptIn: boolean().notNull().default(false),
    termsAcceptedAt: ts(),
    reignId: uuid(), // set when completed
    createdAt: createdAt(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    // At most one active or paying reservation per throne — enforced by the database.
    uniqueIndex("reservations_one_open_per_throne")
      .on(t.throneId)
      .where(sql`${t.state} in ('active', 'paying')`),
    index("reservations_state_expires_idx").on(t.state, t.expiresAt),
    index("reservations_ip_created_idx").on(t.clientIpHash, t.createdAt),
    index("reservations_device_created_idx").on(t.deviceId, t.createdAt),
    index("reservations_intent_idx").on(t.paymentIntentId),
  ],
);

export const payments = pgTable("payments", {
  id: uuid().primaryKey().defaultRandom(),
  reservationId: uuid()
    .notNull()
    .references(() => reservations.id),
  // Named after Stripe; holds the fake provider's intent id in fake mode.
  stripePaymentIntentId: text().notNull().unique(),
  stripeChargeId: text(),
  amountCents: integer().notNull(),
  currency: text().notNull().default("EUR"),
  status: text().notNull(), // succeeded | refunded | partially_refunded | disputed …
  feeCents: integer(),
  refundedCents: integer().notNull().default(0),
  disputed: boolean().notNull().default(false),
  cardFingerprint: text(),
  cardCountry: text(), // VAT evidence (ISO 3166-1 alpha-2), when the provider reports it
  createdAt: createdAt(),
  updatedAt: ts().notNull().defaultNow(),
});

export const stripeEvents = pgTable("stripe_events", {
  eventId: text().primaryKey(), // unique → duplicate webhooks are no-ops
  type: text().notNull(),
  processedAt: ts().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------------------------

export const emailLog = pgTable(
  "email_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid().references(() => customers.id),
    type: text().notNull(), // receipt | overthrow | removal | refund
    throneId: text().$type<ThroneId>(),
    reignId: uuid(),
    providerMessageId: text(),
    // sending (row written before the provider call) → sent | failed; dropped = swallowed by the
    // 15-minute overthrow limit. Overthrow rows carry the id of the overthrown reign.
    status: text().notNull(),
    sentAt: ts().notNull().defaultNow(),
  },
  (t) => [index("email_log_customer_type_sent_idx").on(t.customerId, t.type, t.sentAt)],
);

// ---------------------------------------------------------------------------------------------
// Moderation, reports, bans
// ---------------------------------------------------------------------------------------------

export const moderationChecks = pgTable(
  "moderation_checks",
  {
    id: uuid().primaryKey().defaultRandom(),
    reservationId: uuid(),
    field: text().$type<ModerationField>().notNull(),
    rawText: text().notNull(),
    normalizedText: text().notNull(),
    result: text().$type<ModerationResult>().notNull(),
    category: text(),
    model: text().notNull(), // model id, or "none" when the LLM is disabled
    latencyMs: integer(),
    createdAt: createdAt(),
  },
  (t) => [index("moderation_checks_created_idx").on(t.createdAt)],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid().primaryKey().defaultRandom(),
    reignId: uuid()
      .notNull()
      .references(() => reigns.id),
    reason: text().$type<ReportReason>().notNull(),
    details: text(),
    reporterIpHash: text(),
    status: text().$type<ReportStatus>().notNull().default("pending"),
    createdAt: createdAt(),
    resolvedBy: text(),
    resolvedAt: ts(),
  },
  (t) => [
    index("reports_reign_created_idx").on(t.reignId, t.createdAt),
    index("reports_status_idx").on(t.status),
  ],
);

export const bans = pgTable(
  "bans",
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().$type<BanKind>().notNull(),
    valueHash: text().notNull(), // salted hash (src/server/hash.ts hashBanValue)
    reason: text(),
    expiresAt: ts(), // null = permanent
    createdBy: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("bans_kind_value_idx").on(t.kind, t.valueHash)],
);

export const bannedTerms = pgTable("banned_terms", {
  id: uuid().primaryKey().defaultRandom(),
  term: text().notNull().unique(),
  createdBy: text().notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
// Config, admin, audit, analytics
// ---------------------------------------------------------------------------------------------

/** Key/value configuration. Keys are the field names of AppConfig (src/server/config.ts). */
export const config = pgTable("config", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedBy: text(),
  updatedAt: ts().notNull().defaultNow(),
});

export const adminUsers = pgTable("admin_users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  role: text().notNull().default("admin"),
  createdAt: createdAt(),
});

/** WebAuthn passkeys. `id` is the base64url credential id. */
export const adminCredentials = pgTable("admin_credentials", {
  id: text().primaryKey(),
  adminUserId: uuid()
    .notNull()
    .references(() => adminUsers.id, { onDelete: "cascade" }),
  publicKey: text().notNull(), // base64url COSE public key
  counter: bigint({ mode: "number" }).notNull().default(0),
  transports: jsonb().$type<string[]>(),
  createdAt: createdAt(),
  lastUsedAt: ts(),
});

export const adminSessions = pgTable("admin_sessions", {
  id: text().primaryKey(), // hash of the session cookie value
  adminUserId: uuid()
    .notNull()
    .references(() => adminUsers.id, { onDelete: "cascade" }),
  expiresAt: ts().notNull(),
  createdAt: createdAt(),
});

/** Append only. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    actor: text().notNull(),
    action: text().notNull(),
    target: text(),
    before: jsonb(),
    after: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    props: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("analytics_events_name_created_idx").on(t.name, t.createdAt)],
);

// ---------------------------------------------------------------------------------------------
// Workstream sections (C, S, G) go below this line, each headed `// === <letter>: ... ===`.
// ---------------------------------------------------------------------------------------------
