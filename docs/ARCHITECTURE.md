# The Throne — architecture and team contracts

This is the build plan for the production app described in [PRD.md](PRD.md). The visual and copy
reference is [prototype.html](prototype.html) (open it in a browser). Where they disagree, the PRD wins.

The app is built by several parallel workstreams (sessions). This file is the contract between them:
the stack, the directory layout, **who owns which files**, the shared types, the module signatures that
cross workstream boundaries, and the HTTP/SSE API. If you need to change something in here, do not edit
another workstream's files — record the request in `docs/changes/<workstream>.md` and work around it
with the agreed signature.

## Stack

- **Next.js (App Router, latest stable) + TypeScript (strict)**, single app serving pages, JSON API,
  webhooks, SSE and OG images. Node runtime for all API routes (no edge).
- **PostgreSQL via Drizzle ORM**. Two drivers behind one `db` export:
  - `DATABASE_URL` set → `pg` (node-postgres) pool. `docker-compose.yml` provides a local Postgres.
  - unset → **PGlite** (embedded Postgres, WASM): file-backed at `.data/pglite` in dev, in-memory in tests.
    All transactions must be serialized correctly on PGlite (it is a single connection — verify that
    concurrent `db.transaction()` calls queue instead of interleaving; add a mutex if needed).
  - Migrations: `drizzle-kit generate` → SQL in `drizzle/`, applied automatically on first DB use.
- **Payments**: `PaymentProvider` interface with two implementations:
  - `stripe` when `STRIPE_SECRET_KEY` is set (manual capture PaymentIntents, Payment Element on the client);
  - `fake` otherwise: no network, a "test card" form on the client, authorizations simulated through
    `POST /api/dev/fake-pay/{reservationId}` which runs the *same* server code path as the Stripe webhook.
- **Real-time**: Server-Sent Events from `GET /api/thrones/{throne}/events`, fed by an in-process event
  bus (`src/server/bus.ts`, `globalThis` singleton). Presence = number of open SSE connections per throne.
  Single-instance for now; the bus interface allows swapping in Redis pub/sub later.
- **Jobs**: pure functions in `src/server/throne/jobs.ts`, run (a) in-process via `src/instrumentation.ts`
  timers when `JOBS_INPROCESS !== "0"`, and (b) via `GET /api/cron/{job}` guarded by `CRON_SECRET`.
- **Email**: `EmailProvider` — Resend when `RESEND_API_KEY` is set, otherwise a dev outbox (rows in
  `email_log` + HTML files in `.data/outbox/`, viewable at `/dev/outbox`).
- **Moderation LLM**: Anthropic API (`claude-haiku-5-5`), 5 s timeout, JSON verdict. Without
  `ANTHROPIC_API_KEY`: fail closed (503) in production; in development allowed only if
  `MODERATION_LLM=disabled` (then regex + banned terms only, model logged as `none`). `.env.example`
  sets `MODERATION_LLM=disabled` for local dev.
- **Tests**: Vitest (unit + integration against in-memory PGlite, fake clock, fake payments).
  Playwright is optional for e2e.
- Package manager: **npm**. Node 22. Developed on Windows — keep scripts cross-platform (no `rm -rf`,
  no bash-only syntax in package.json).

## Directory layout and ownership

Workstreams: **F** foundation, **C** core (pricing/reservations/payments/realtime/jobs),
**U** public UI, **S** safety (moderation/reports/bans/admin/disputes), **G** growth
(emails/reclaim/share pages/OG/legal/analytics).

```
docs/                                   orchestrator
drizzle/                                F (C, S, G may add migrations — see "Schema changes")
src/
  instrumentation.ts                    F (C fills job registration)
  proxy.ts                              F  device-id cookie `kti_device` (random, httpOnly, 1y). Next 16 renamed
                                           middleware.ts → proxy.ts (Node runtime); same role.
  lib/                                  isomorphic, no server-only imports
    contracts.ts                        F  shared DTOs — frozen after F; changes via docs/changes
    pricing.ts                          F  min price, titles, rounding (pure, integer cents)
    crest.ts                            F  crest algorithm → SVG markup string (pure)
    format.ts                           F  money, durations, relative time
    copy.ts                             F  all UI strings (U/S/G append their own keys in own sections)
    normalize.ts                        S  text normalization (F ships a working basic version)
    analytics.ts                        G  client `track(event, props)` (F ships a no-op)
  server/
    db/schema.ts, db/client.ts          F
    clock.ts                            F  `now()`; tests can `setNow()` / `advance()`
    config.ts                           F  config table + defaults, 30 s cache, `getConfig()`
    bus.ts                              F  publish/subscribe
    hash.ts                             F  salted hashing (IP, device, email for bans)
    http.ts                             F  JSON error helper, request IP, device id, CSRF origin check
    payments/{provider,fake,stripe}.ts  F interface + fake skeleton; C completes both
    throne/                             C  state, reservations, crown, jobs, presence, ratelimit, admin-ops
    moderation/                         S  (F ships stub)
    bans.ts                             S  (F ships stub)
    disputes.ts                         S  (F ships stub)
    admin/                              S
    notifications/                      G  (F ships stub)
    email/                              G
  app/
    layout.tsx, globals.css             F  fonts (UnifrakturMaguntia, Schibsted Grotesk), tokens from prototype
    page.tsx, daily/page.tsx            U  (F ships a placeholder page.tsx)
    r/[reignId]/                        G
    og/                                 G  `/og/r/[reignId]`, `/og/[throne]` (route handlers returning PNG)
    legal/*                             G  terms, privacy, imprint, contact, refunds
    admin/                              S
    dev/outbox/                         G
    api/thrones/[throne]/route.ts                 C  GET state
    api/thrones/[throne]/reigns/route.ts          C  GET history
    api/thrones/[throne]/events/route.ts          C  SSE
    api/thrones/[throne]/reservations/route.ts    C  POST
    api/reservations/[id]/route.ts                C  GET, DELETE
    api/reservations/[id]/heartbeat/route.ts      C  POST
    api/reservations/[id]/confirm/route.ts        C  POST
    api/reigns/[id]/route.ts                      C  GET
    api/config/public/route.ts                    C  GET
    api/webhooks/stripe/route.ts                  C  (dispatches disputes/refunds to S)
    api/dev/fake-pay/[id]/route.ts                C
    api/cron/[job]/route.ts                       C
    api/reports/route.ts                          S
    api/admin/**                                  S
    api/unsubscribe/route.ts                      G
    api/reclaim/route.ts                          G
    api/events/route.ts                           G  analytics ingest
  components/                           U  (S and G use their own subfolders: components/admin, components/share)
  hooks/                                U
```

## Shared types (`src/lib/contracts.ts`)

```ts
export type ThroneId = "eternal" | "daily";
export type Title = "Lord" | "Baron" | "Duke" | "Archduke" | "Emperor";
export type EndReason = "takeover" | "removed" | "reset" | "refunded" | "disputed";
export type ReservationState = "active" | "paying" | "completed" | "expired" | "released" | "failed";
export type FailReason =
  | "expired" | "released" | "card_declined" | "outbid"     // outbid = authorized but reservation/throne no longer valid
  | "capture_failed" | "canceled" | "moderation" | "banned";
export type PaymentMode = "stripe" | "fake";

export interface ReignDTO {
  id: string;
  throne: ThroneId;
  name: string;
  proclamation: string | null;      // null when empty
  proclamationBlurred: boolean;     // 3+ reports pending (PRD "Reports")
  paidCents: number;
  title: Title;
  startedAt: string;                // ISO
  endedAt: string | null;
  endReason: EndReason | null;
  lengthMs: number;                 // computed with server now for ongoing reigns
}

export interface ThroneState {
  throne: ThroneId;
  serverNow: string;                // ISO, client uses it to correct clock skew
  version: number;
  king: (ReignDTO & { crownedAt: string }) | null;   // null when vacant
  vacancy: null | { reason: "never" | "removed" | "reset"; yesterdayRuler: string | null };
  minCents: number;                 // current minimum (decay / daily reset applied)
  nextMinCentsAtMinimum: number;    // what the next challenger pays if this buyer pays minCents
  idleDays: number;                 // eternal: full idle days (decay info); daily: 0
  resetsAt: string | null;          // daily: next 00:00 UTC; eternal: null
  reservation: { lockedUntil: string } | null;  // another buyer in checkout (no buyer data)
  stats: {
    reignCount: number;             // eternal: all-time; daily: today
    totalPaidCents: number;
    longest: ReignDTO | null;
    highest: ReignDTO | null;
  };
  recent: ReignDTO[];               // last 12, newest first, hidden reigns excluded
  lastTakeoverAt: string | null;
  watching: number;
}

export interface PublicConfig {
  currency: "EUR";
  baseCents: number; stepBps: number; decayBps: number; maxCents: number;
  nameMax: number; proclamationMax: number;
  reservationMs: number; heartbeatMs: number;
  paymentMode: PaymentMode;
  stripePublishableKey: string | null;
}

export interface CreateReservationResponse {
  reservationId: string;
  reservationToken: string;         // send as header X-Reservation-Token on every reservation call
  clientSecret: string;             // Stripe client secret, or "fake_..." in fake mode
  minCents: number;
  expiresAt: string;
  paymentMode: PaymentMode;
}

export interface ConfirmReservationRequest {
  amountCents: number; name: string; proclamation: string; email: string;
  alertOptIn: boolean; termsAccepted: boolean;
}

export interface ReservationStatus {
  id: string; throne: ThroneId; state: ReservationState; failReason: FailReason | null;
  expiresAt: string; minCents: number; amountCents: number | null; reignId: string | null;
}

export interface ApiError { error: string; message: string; [extra: string]: unknown }

export type ThroneEvent =
  | { type: "throne.updated"; data: ThroneState }
  | { type: "reservation.updated"; data: { state: ReservationState | null; lockedUntil: string | null } }
  | { type: "presence.count"; data: { watching: number } }
  | { type: "reservation.result"; data: { reservationId: string; state: ReservationState; failReason: FailReason | null; reignId: string | null } };
```

## HTTP API

All bodies JSON. Errors: `ApiError` with HTTP status. Mutating routes check `Origin` (CSRF).

| Method | Path | Success | Errors |
|---|---|---|---|
| GET | `/api/thrones/{throne}` | `ThroneState` | 404 unknown throne |
| GET | `/api/thrones/{throne}/reigns?cursor=` | `{ reigns: ReignDTO[], nextCursor: string \| null }` (50/page) | |
| GET | `/api/thrones/{throne}/events?reservationId=&token=` | SSE stream of `ThroneEvent` (`event: <type>`, `data: <json>`); first event is `throne.updated`; `: ping` every 15 s. With a valid reservation id+token the stream also carries that reservation's private `reservation.result`. | |
| POST | `/api/thrones/{throne}/reservations` body `{ source?: "button"\|"tryon"\|"reclaim" }` | 201 `CreateReservationResponse` | 409 `{error:"busy", lockedUntil}`, 429 `{error:"rate_limited"}`, 403 `{error:"banned"}` |
| POST | `/api/reservations/{id}/heartbeat` | `ReservationStatus` | 401 bad token, 410 expired |
| POST | `/api/reservations/{id}/confirm` body `ConfirmReservationRequest` | `ReservationStatus` (state `paying`) | 410 expired, 422 `{error:"amount"\|"validation"\|"moderation", field?, category?}`, 503 `{error:"moderation_unavailable"}`, 403 banned |
| GET | `/api/reservations/{id}` | `ReservationStatus` | |
| DELETE | `/api/reservations/{id}` | 204 | |
| POST | `/api/dev/fake-pay/{id}` body `{ outcome: "succeed" \| "decline" }` (fake mode only, token required) | `ReservationStatus` | 404 when not in fake mode |
| GET | `/api/reigns/{id}` | `ReignDTO & { hidden: boolean }` (hidden → name/proclamation blanked) | 404 |
| GET | `/api/config/public` | `PublicConfig` | |
| POST | `/api/webhooks/stripe` | 200 | 400 bad signature |
| GET | `/api/cron/{expire\|reconcile\|daily-reset\|retention}` | `{ ok: true, ... }` | 401 without `Authorization: Bearer $CRON_SECRET` |
| POST | `/api/reports` body `{ reignId, reason: "offensive"\|"impersonation"\|"spam"\|"other", details? }` | 201 | 429 |
| GET | `/api/unsubscribe?token=` | HTML confirmation | |
| GET | `/api/reclaim?token=` | 302 → `/` or `/daily` with `?checkout=1&name=<old name>` | expired token → 302 without prefill |
| POST | `/api/events` | 204 (analytics ingest) | |

Client query params understood by the throne pages (U): `?checkout=1&name=...` opens checkout with the name
prefilled (reclaim flow, source `reclaim`).

## Cross-workstream module contracts

F ships every function below as a **stub with exactly this signature** so all workstreams compile from day
one. The owner replaces the body. Callers never import anything else from another workstream's folder.

```ts
// src/server/moderation/index.ts  — owner S. Stub: normalizes, returns ok.
export type ModerationOutcome =
  | { ok: true; name: string; proclamation: string }            // normalized texts to store/display
  | { ok: false; status: 422 | 503; field: "name" | "proclamation" | null; category: string; message: string };
export function moderateSubmission(input: { reservationId: string; name: string; proclamation: string }): Promise<ModerationOutcome>;

// src/server/bans.ts — owner S. Stub: never banned.
export function checkBans(q: { email?: string; ipHash?: string; deviceId?: string; cardFingerprint?: string }): Promise<{ banned: boolean; reason?: string }>;

// src/server/disputes.ts — owner S. Stub: logs. Called by C's webhook route.
export function handleDisputeCreated(event: import("stripe").Stripe.Event): Promise<void>;
export function handleDisputeClosed(event: import("stripe").Stripe.Event): Promise<void>;
export function handleChargeRefunded(event: import("stripe").Stripe.Event): Promise<void>;

// src/server/notifications/index.ts — owner G. Stub: logs. C calls it after the crown transaction commits
// (fire-and-forget, must never throw into C). Sends receipt + overthrow email per PRD rules.
export function onTakeoverCommitted(e: { throne: ThroneId; reignId: string; previousReignId: string | null }): Promise<void>;
// S calls this after an admin removal when "notify king" is chosen.
export function onKingRemoved(e: { reignId: string; reasonCategory: string; notify: boolean }): Promise<void>;
export function onRefundIssued(e: { reignId: string; amountCents: number }): Promise<void>;

// src/server/throne/admin-ops.ts — owner C. Used by S (admin console, disputes, refunds, reports).
// Each locks the throne row, bumps version, writes audit_log, broadcasts throne.updated.
export function removeCurrentKing(throne: ThroneId, opts: { reason: EndReason; reasonCategory: string; actor: string; reignId?: string }): Promise<{ removedReignId: string | null }>;
export function setReignHidden(reignId: string, hidden: boolean, actor: string): Promise<void>;
export function setReignBlurred(reignId: string, blurred: boolean): Promise<void>;
export function broadcastThrone(throne: ThroneId): Promise<void>;   // recompute + publish throne.updated

// src/server/throne/state.ts — owner C. Used by G (OG images, share pages) and S (admin live view).
export function getThroneState(throne: ThroneId): Promise<ThroneState>;
export function getReign(id: string): Promise<(ReignDTO & { hidden: boolean }) | null>;

// src/server/payments/provider.ts — owner F (interface), C (implementations).
export interface PaymentProvider {
  mode: PaymentMode;
  createIntent(p: { amountCents: number; reservationId: string; throne: ThroneId }): Promise<{ id: string; clientSecret: string }>;
  updateAmount(id: string, amountCents: number, meta?: Record<string, string>): Promise<void>;
  capture(id: string, idempotencyKey: string): Promise<{ chargeId: string | null; feeCents: number | null; cardFingerprint: string | null }>;
  cancel(id: string): Promise<void>;
  // Card fields are known once a card is authorized: crown checks checkBans({ cardFingerprint }) before
  // capture (hit → cancel, fail reason "banned") and stores cardCountry in payments.card_country.
  retrieve(id: string): Promise<{ status: "requires_payment_method" | "requires_confirmation" | "requires_action" | "requires_capture" | "succeeded" | "canceled" | "processing"; amountCapturable: number; cardFingerprint?: string | null; cardCountry?: string | null }>;
  refund(chargeOrIntentId: string, amountCents?: number): Promise<void>;
}
export function getPaymentProvider(): PaymentProvider;
```

Pure helpers in `src/lib` (owner F, everyone uses them):

```ts
// pricing.ts — integer cents, round half up once per computation
export function minPriceCents(throne: ThroneId, last: { paidCents: number; crownedAt: Date } | null, now: Date, cfg?: PricingConfig): number;
export function nextMinCents(paidCents: number, cfg?: PricingConfig): number;     // round(paid × 1.10)
export function idleDays(crownedAt: Date, now: Date): number;
export function titleFor(paidCents: number): Title;
export const TITLE_THRESHOLDS: { title: Title; minCents: number }[];
export function priceAtStep(k: number, cfg?: PricingConfig): number;            // for the ladder chart (no rounding chain)
// crest.ts
export function crestSpec(name: string | null): { field: string; second: string; division: 0|1|2|3|4; initial: string };
export function crestSvg(name: string | null, opts?: { size?: number; idPrefix?: string }): string;   // full <svg> markup, viewBox 0 0 100 120
// format.ts
export function formatMoney(cents: number, opts?: { round?: boolean; locale?: string }): string;
export function formatDuration(ms: number): string;   // "41s", "12m 03s", "2h 14m 09s", "3d 4h 05m"
export function formatAgo(ms: number): string;         // "just now", "4 minutes ago", ...
export function formatClock(ms: number): string;       // "2:41"
```

## Database

Tables exactly as in the PRD "Data model" section, plus:

- `reigns.blurred boolean default false`, `reigns.customer_email_hash` not needed (join via customer_id).
- `reigns.disputed boolean default false` (migration `0001_reigns_disputed`): set by S's dispute handler
  for current and ended reigns; a current reign is also removed with `end_reason = disputed`.
- `admin_credentials` (WebAuthn credential id, public key, counter, admin_user_id), `admin_sessions`
  (id, admin_user_id, expires_at).
- `analytics_events` (id, name, props jsonb, created_at).
- `reservation_token_hash` on reservations.
- `thrones` seeded with rows `eternal` and `daily` (version 0, nothing paid).
- `config` seeded with PRD defaults.

Schema changes after F: a workstream that needs a new column/table adds it to `schema.ts` **only in a
clearly delimited section headed with its workstream letter** and generates a new migration file. The
orchestrator resolves migration ordering at merge time.

Columns F added beyond the PRD (all nullable or defaulted): `reservations.paying_at` (reconcile job),
`reservations.source` (`button|tryon|reclaim`), `reservations.reign_id` (set on completion),
`created_at`/`updated_at` on most tables, `customers.alert_opt_in_at` (consent timestamp),
`payments.card_country` (VAT evidence), `email_log.throne_id` (15-minute overthrow limit per throne).
Drizzle uses `casing: "snake_case"`: TS fields are camelCase, SQL columns snake_case. Enum-like columns are
`text` typed with the unions from `contracts.ts` (no DB enums, so new values need no migration).

### DB access (`src/server/db/client.ts`)

```ts
export type Database;                 // Drizzle PgDatabase with the full schema (same API on pg and PGlite)
export type Tx;                       // the `tx` inside db.transaction(async (tx) => …)
export type DbOrTx = Database | Tx;
export function getDb(): Promise<Database>;          // migrated + seeded on first call; globalThis singleton
export function createTestDb(): Promise<Database>;   // fresh in-memory PGlite, migrated + seeded
export function setTestDb(db: Database | null): void; // route getDb() to a test db
export function closeDb(): Promise<void>;
```

There is no synchronous `db` export: migrations run on first use, so callers `const db = await getDb()`.
**Inside a transaction use only `tx`.** PGlite is one connection that queues every query behind the open
transaction (that is what makes concurrent transactions serialize — proven by `src/server/db/db.test.ts`,
50 concurrent `FOR UPDATE` + insert → 1 row, 49 unique violations), so touching the outer db inside a
transaction would deadlock; the PGlite client throws `Use the transaction's tx` instead. Do side effects
(notifications, broadcasts) after the transaction resolves.

### Next.js 16 notes

- Cache Components is **off** (`next.config.ts`). Pages that read the DB call `await connection()` from
  `next/server` so they render per request and never at build time. Route handlers are dynamic by default.
- `serverExternalPackages: ["@electric-sql/pglite", "pg"]`. `src/instrumentation.ts` skips work during
  `next build` (`NEXT_PHASE === "phase-production-build"`); never open the DB at build time — `next dev` and
  `next build` must not share `.data/pglite` concurrently.

### Extra F helpers (beyond the signatures above)

- `pricing.ts`: `PricingConfig`, `DEFAULT_PRICING`, `DAY_MS`, `nextTitle(title)`, `isValidAmount(amount, min, cfg?)`,
  `utcDateKey(d)`, `nextUtcMidnight(now)`. `minPriceCents` does not clamp to `maxCents` (C decides what to do
  if the minimum ever exceeds the cap).
- `crest.ts`: `crestHash(s)`, `crestGroup(name, { idPrefix })` (inner `<g>` for the throne backrest). The
  initial `<text>` has class `crest-initial`; `globals.css` maps it to the blackletter font.
- `format.ts`: `article(word)`, `truncateName(name, 16)`. `formatMoney` uses the runtime locale unless
  `locale` is given — pass one for server-rendered text that must hydrate identically.
- `copy.ts`: `copy` object (shared strings + `copy.ui` / `copy.safety` / `copy.growth` sections for U/S/G)
  and `fill(template, vars)` for `{placeholder}` strings.
- `normalize.ts`: `normalizeText`, `hasCombiningAbuse`, `textLength` (code points).
- `server/clock.ts`: `now()`, `nowMs()`, `setNow()`, `advance()`, `resetClock()`.
- `server/config.ts`: `getConfig(): Promise<AppConfig>` (keys and defaults in `config-defaults.ts`),
  `updateConfig(patch, actor)`, `invalidateConfigCache()`, `pricingConfig(cfg)`.
- `server/bus.ts`: `publish(throne, event)`, `subscribe(throne, listener) → unsubscribe`, `listenerCount(throne)`.
  `reservation.result` is published on the throne channel; the SSE route forwards it only to the owner.
- `server/hash.ts`: `saltedHash`, `hashIp`, `hashDevice`, `hashEmail`, `hashBanValue(kind, value)`,
  `hashToken` (reservation tokens), `randomToken`, `safeEqual`, `signToken(purpose, payload, ttlMs)`,
  `verifyToken(purpose, token)`.
- `server/http.ts`: `json`, `apiError`, `HttpError`, `withErrors(handler)`, `readJson`, `clientIp`,
  `getCookie`, `deviceId`, `checkOrigin` / `assertOrigin`.
- `server/payments/provider.ts`: `IntentStatus` (the `retrieve` status union), `paymentMode()`,
  `setPaymentProvider()` (tests). `FakePaymentProvider` adds `authorize(id)` / `decline(id)` for
  `/api/dev/fake-pay`.
- `server/throne/state.ts` (C): F's version is DB-backed and tested (`isThroneId`, `THRONE_IDS`, `toReignDTO`,
  `utcDayStart` also exported). `getReign` blanks name/proclamation of hidden reigns. `watching` currently
  uses `listenerCount(throne)` from the bus.

## Correctness rules (C owns, everyone respects)

- The throne row (`SELECT … FOR UPDATE`) is the lock for every state change on a throne.
- Unique partial index `reservations(throne_id) WHERE state IN ('active','paying')`.
- Crown transaction: capture first (idempotency key = reservation id), then in the same DB transaction:
  insert reign, end previous reign, update throne (`current_reign_id`, `last_paid_cents`, `crowned_at`,
  `version+1`), mark reservation completed, insert payment row. Any failed check → cancel the intent.
- `stripe_events.event_id` unique → duplicate webhooks are no-ops.
- Never trust client amounts/titles; everything recomputed server-side.

## Environment variables (`.env.example`)

`DATABASE_URL` (optional), `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`,
`RESEND_API_KEY`, `EMAIL_FROM`, `ANTHROPIC_API_KEY`, `MODERATION_LLM` (`enabled`|`disabled`),
`APP_URL` (default `http://localhost:3000`), `HASH_SALT`, `TOKEN_SECRET` (signing reclaim/unsubscribe
tokens), `CRON_SECRET`, `JOBS_INPROCESS`, `ADMIN_EMAILS`, `ADMIN_BOOTSTRAP_TOKEN`, `ADMIN_DEV_LOGIN`.

## Definition of done for every workstream

- `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass.
- Only files you own were changed (plus your delimited schema section / migration / copy section).
- Committed on your branch with a clear message; final report lists what is done, what is not, and any
  contract change requests.
