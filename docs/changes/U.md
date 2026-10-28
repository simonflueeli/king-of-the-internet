# U (public UI) — contract notes and requests

No change to `contracts.ts` is required. The UI relies on these behaviours, which the contract leaves open.
Please confirm them (C unless noted).

1. **Re-confirm after a decline.** After a card decline (Stripe `confirmPayment` error, or
   `POST /api/dev/fake-pay/{id}` with `decline`), the buyer may press Pay again. The UI then calls
   `POST /api/reservations/{id}/confirm` again while the reservation is `paying`. Confirm must accept that
   (update amount and texts, keep the extended expiry) instead of rejecting it.
2. **Fake-mode decline result.** `POST /api/dev/fake-pay/{id}` with `decline` should return 200 with a
   `ReservationStatus` whose `failReason` is `"card_declined"` and whose state is still `active` or `paying`.
   The UI shows "Your card was declined. Try another card." and lets the buyer retry. A terminal
   `failed/card_declined` also works, but then the buyer has to reopen checkout.
3. **Cancel after a decline.** `DELETE /api/reservations/{id}` should also release a `paying` reservation
   when nothing is authorized yet (for example after a decline). Otherwise the buyer's own lock blocks the
   throne for up to 10 minutes (PRD: "Cancel… releases the reservation immediately").
4. **Stripe deferred-intent setup.** The Payment Element is mounted in deferred mode
   (`mode: "payment"`, `currency: "eur"`, `captureMethod: "manual"`, amount = the buyer's chosen amount).
   The UI calls `elements.submit()`, then `/confirm`, then `stripe.confirmPayment({ elements, clientSecret })`.
   The PaymentIntent must use `capture_method: "manual"` and payment method types compatible with the
   Payment Element (automatic payment methods), and `/confirm` must update its amount before returning.
5. **Error bodies.** For 422 `validation`/`moderation` the UI shows `message` verbatim and focuses
   `field` (`name | proclamation | email | terms`). For 422 `amount`, 410, 503 and 403 it uses the PRD copy.
   So `message` must be buyer-facing text (S for moderation categories).
6. **`reservation.result` on the SSE stream.** While checkout is open, the UI reconnects
   `GET /api/thrones/{throne}/events?reservationId=…&token=…` (one stream per tab; the plain stream is
   closed first, so presence should not double-count). It also polls `GET /api/reservations/{id}` every 2 s
   once payment is authorized.
7. **`GET /api/reservations/{id}` auth.** The UI sends `X-Reservation-Token` on GET and DELETE as well, not
   only on heartbeat and confirm.
8. **Analytics (G).** The UI tracks `page_view` with `referrer: "overthrow_email"` when the page opens with
   `?checkout=1`. It does not send `overthrow_email_clicked`, because the minutes since the overthrow are
   only known to `/api/reclaim`. G could track that server-side.
9. **Stripe redirect return (open).** `confirmPayment` uses `redirect: "if_required"` with
   `return_url` = the throne page. Cards with 3-D Secure complete in place. If a payment method ever
   redirects, the page reloads without the coronation screen. The webhook still crowns the buyer, and the
   receipt email confirms it. Resuming the coronation screen after a redirect is not built.
10. **Optional (F).** Mock-mode code is only loaded when `NODE_ENV !== "production"` or
    `NEXT_PUBLIC_MOCK_API=1`. In production it sits in lazy chunks that are never requested. To strip it
    statically, F could add `env: { NEXT_PUBLIC_MOCK_API: process.env.NEXT_PUBLIC_MOCK_API ?? "" }` to
    `next.config.ts`.
