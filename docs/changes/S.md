# S (safety) — contract notes and change requests

All cross-workstream signatures are unchanged (`moderateSubmission`, `checkBans`, `handleDispute*`,
`handleChargeRefunded`). No schema changes, no migration. The items below are requests or usage notes
for the orchestrator and the other workstreams.

## Requests

1. **package.json (F)** — S added three dependencies: `@anthropic-ai/sdk` ^1.3.0, `@simplewebauthn/server`
   ^14.0.3, `@simplewebauthn/browser` ^14.0.0 (plus the lockfile). Merge them with the other branches'
   dependency changes.
2. **Retention job (C)** — PRD "Retention": delete `moderation_checks` older than
   `config.moderationRetentionDays` (180) and expired `bans` rows. S did not touch `jobs.ts`.
3. **Optional: `reigns.disputed` (F/C)** — the PRD says "mark the reign disputed". S does it through
   `reigns.end_reason = "disputed"` when the disputed reign is current (via `removeCurrentKing`) and
   `payments.disputed = true` in every case. A dispute on an already-ended reign therefore keeps its
   original `end_reason`. If a flag on the reign itself is wanted, add a column and S will set it.

## Usage notes for callers

### C (confirm route, webhook route)
- Call `moderateSubmission` and `checkBans` **outside** any DB transaction (they use `getDb()`;
  `moderateSubmission` writes one `moderation_checks` row per field).
- `moderateSubmission` → `{ ok: false, status, field, category, message }`. `status` 503 means
  `moderation_unavailable`; 422 categories are:
  - `empty` | `too_long` | `combining_marks` — normalization/length rules (map to `error: "validation"`
    with `field` if you prefer; the message is ready to show);
  - `links` | `banned_term` | `hate` | `harassment` | `sexual` | `violence` | `self_harm` |
    `impersonation` | `spam` | `personal_data` | `other` → `error: "moderation"`.
  `message` is always a fixed copy string (`copy.safety.moderation.*`), never model text.
  On `ok: true`, store the returned normalized `name` / `proclamation` (empty proclamation → `""`).
- `checkBans({ email, ipHash, deviceId, cardFingerprint })`: pass `ipHash = hashIp(clientIp(req))` (the
  same value as `reservations.client_ip_hash`) and the raw `kti_device` cookie value as `deviceId`.
  Card fingerprint check belongs after authorization/capture (Stripe gives the fingerprint then).
- Dispute/refund handlers find the payment by `payments.stripe_charge_id` or
  `payments.stripe_payment_intent_id`, and the reign by `reigns.payment_id` (fallback
  `reservations.reign_id`). Please set `payments.card_fingerprint` and `reigns.payment_id` in the crown
  transaction. Handlers are idempotent on their own (refunds are recorded as absolute
  `amount_refunded`), but still dispatch them only after the `stripe_events` check.
- Admin refunds call `getPaymentProvider().refund(stripeChargeId ?? stripePaymentIntentId, amount)`.
  In fake mode the in-memory intents are lost on a dev-server restart, so refunding an older payment
  then returns 502 "provider rejected" — expected.

### G (notifications)
- `onKingRemoved({ reignId, reasonCategory, notify })` is called after **every** admin removal (console
  and report queue "remove"); `notify` says whether the admin ticked "Email the king". Disputes and
  refunds do not call it. `reasonCategory` is one of `REMOVAL_CATEGORIES` in `src/server/admin/ops.ts`
  (labels in `copy.safety.admin.removalCategories`).
- `onRefundIssued({ reignId, amountCents })` is called once per refund increase with the **delta**
  amount (admin refund or Stripe-initiated `charge.refunded`), fire-and-forget.

### U (Report form)
- `POST /api/reports` body `{ reignId, reason: "offensive"|"impersonation"|"spam"|"other", details? }`
  (details ≤ 500 chars after normalization). 201 `{ ok: true, message }`; 422 `validation`; 404
  `not_found`; 429 `rate_limited` (5 reports per IP per 10 min); 403 cross-origin. Messages in
  `copy.safety.reports`. Repeat reports from the same IP for the same reign return 201 but count once.
- The checkout form can reuse `normalizeField` / `textLength` from `src/lib/normalize.ts` for its live
  counter (lengths are Unicode code points after normalization).
