# G (growth): contract notes and change requests

No stub signatures changed. `onTakeoverCommitted`, `onKingRemoved` and `onRefundIssued` keep their
exact signatures; `src/server/notifications/index.ts` additionally exports `flushNotifications()`
(awaits background sends; for tests and scripts). No schema changes, no migration.

## What G expects from C (crown transaction)

1. `reigns.customer_id` is set for every paid reign (receipt and overthrow emails find the address
   through it; a reign without a customer gets no email).
2. `reservations.reign_id` and `reservations.alert_opt_in` are set on completion. G reads the opt-in
   of the reservation that created the overthrown reign; only if none is linked does it fall back to
   `customers.alert_opt_in`.
3. On an opted-in purchase, set `customers.alert_opt_in = true` and `customers.alert_opt_in_at = now()`.
   G treats an `alert_opt_in_at` later than `unsubscribed_at` as fresh consent (re-subscribed). If
   the orchestrator prefers "unsubscribe is forever", C should not touch `alert_opt_in_at` for
   unsubscribed customers. Either way G needs no change.
4. Call `onTakeoverCommitted({ throne, reignId, previousReignId })` after the transaction commits, with
   `previousReignId` = the reign this takeover ended (`end_reason = 'takeover'`), or `null`. G ignores
   a previous reign that ended any other way (reset, removal), dedupes repeated calls for the same
   takeover, and returns immediately (the work runs in `after()` / a detached promise).

## What G expects from S

- `onKingRemoved` sends the removal notice only when `notify` is true; `reasonCategory` is shown
  humanized ("spam_link" → "Spam link"). One notice per reign.
- `onRefundIssued` sends one email per call (partial refunds are legitimate repeats), so call it once
  per refund event.
- Share pages and OG images treat `hidden = true` or `end_reason in (removed, refunded, disputed)` as
  "no longer shown" (FR-73). The in-process OG cache never serves a reign image once it is hidden.

## What G offers to U

- `/r/{reignId}` links to `/` or `/daily`; `/api/reclaim` redirects to `/?checkout=1&name=…` (or
  `/daily?…`), and to plain `/` for invalid or expired tokens.
- `track(event, props)` is live. Recommended property names per event are documented at the top of
  `src/lib/analytics.ts` (snake_case; the ingest accepts any flat primitives under those rules).
  `overthrow_email_clicked` is recorded server-side by `/api/reclaim`; U does not need to send it.
- `src/components/share/Stage.tsx` exports `LegalLinks` (footer links to the five legal pages) if U
  wants to reuse it.
- Suggestion: for `page_view.referrer`, U can treat `?checkout=1&name=` as "email" and a `document.referrer`
  under `/r/` as "share".

## Requests to F / orchestrator (files G does not own)

1. `.env.example`: add optional `SUPPORT_EMAIL=` (support contact in receipts and on /legal/contact;
   defaults to the address in `EMAIL_FROM`).
2. `next.config.ts`, only if deploying with output tracing (Vercel or `output: "standalone"`): add
   `outputFileTracingIncludes: { "/og/**": ["./src/app/og/_fonts/**"] }`. The OG routes read the
   bundled TTFs with `fs` from `process.cwd()`, which `next start` serves fine.
3. `email_log.status` gains the transient value `sending` (row written before the provider call, then
   set to `sent` / `failed`; `dropped` = swallowed by the 15-minute limit). Overthrow rows carry the
   **overthrown** reign's id. The schema comment in `schema.ts` could mention both.

## Open points for launch

- Real `RESEND_API_KEY`, `EMAIL_FROM` on a domain with SPF/DKIM/DMARC, `APP_URL` on the real domain
  (all email links and OG URLs are absolute and built from it), long random `TOKEN_SECRET`.
- `GET /api/unsubscribe` unsubscribes immediately, as specified. Some corporate mail scanners prefetch
  links; if that causes accidental unsubscribes, switch GET to a confirmation button and keep the RFC
  8058 POST as the one-click path.
- Legal pages and the receipt's VAT line are placeholders (`[TO BE SUPPLIED BY LEGAL]`).
