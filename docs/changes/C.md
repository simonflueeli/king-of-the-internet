# C (core) — contract notes and change requests

All agreed signatures in `docs/ARCHITECTURE.md` are kept unchanged. Items below are either
clarifications of behaviour other workstreams rely on, or requests for the orchestrator.

## Change requests (not implemented — need F/orchestrator approval)

1. **`PaymentProvider.retrieve` could also return `cardFingerprint` and `cardCountry`** (optional
   fields). Today card bans (`checkBans({ cardFingerprint })`) cannot be enforced before capture, and
   `payments.card_country` (VAT evidence) stays null because `capture()` only returns
   `{ chargeId, feeCents, cardFingerprint }`. With the extra fields C would cancel instead of
   capturing a banned card and fill `card_country`.
2. **`copy.ts`**: C added a `core` section (`copy.core.*`) and appended it to the exported `copy`
   object (one-line change to F's export line).

## Behaviour other workstreams should know

- **Admin ops do not invalidate an open checkout.** `removeCurrentKing`, `setReignHidden`,
  `setReignBlurred` and the daily reset bump `thrones.version` and carry the open reservation's
  `throne_version` along, so a buyer who is paying is still crowned at their locked price. Only a
  takeover changes the version a reservation is checked against.
- **Daily reset is also applied lazily**: a takeover on the Daily Throne after midnight, before
  the reset job ran, ends yesterday's reign with `end_reason = reset`, `ended_at = 00:00 UTC`, and
  `onTakeoverCommitted` gets `previousReignId: null` (no overthrow email for a reign the day ended).
- **Customers** are upserted at confirm. The latest checkout choice sets `customers.alert_opt_in`;
  opting in sets `alert_opt_in_at = now` and clears `unsubscribed_at` (fresh consent). The per-purchase
  choice is also on `reservations.alert_opt_in` (G: reign → payment → reservation).
- **`reservations.device_id`** stores the raw `kti_device` cookie value (random, not personal);
  `client_ip_hash` is `hashIp(ip)`. `checkBans` receives `{ ipHash: hashIp(ip), deviceId: raw, email }`.
- **Fail reasons**: silence/cancel → `released/released`; time out → `expired/expired`; authorization
  arriving after expiry → `expired/outbid` (UI shows "Your card wasn't charged…"); throne changed →
  `failed/outbid`; authorized without confirm or amount mismatch → `failed/canceled`; capture error →
  `failed/capture_failed`; ban at confirm → `failed/banned`. A declined card keeps the reservation
  `paying` with `failReason: "card_declined"` until it expires (buyer may try another card; calling
  confirm again is allowed while the intent is not yet authorized).

## Status after integration (merged main)

- Request 1 (card fields on `retrieve`) — **applied**: `IntentSnapshot` in `provider.ts`, fake and
  Stripe fill `cardFingerprint` / `cardCountry`; crown checks card bans before capture and stores
  `payments.card_country`. ARCHITECTURE updated.
- DELETE now answers 409 `payment_in_progress` once the card is authorized (releasing then would race
  the crown); a `paying` reservation without an authorization is released as before (U.md 3).
- S2 (retention), S3 (`reigns.disputed`), G1–G3 and U10 applied by the integrator.
