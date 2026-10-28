The Throne – Product Requirements
 · 
Overview
The Throne is a mobile-first web app where anyone can pay to put their name on a public throne until someone pays more. Each takeover costs at least 10% more than the last. The dethroned king gets nothing back except an email inviting them to win the seat back.
This document specifies the production version: real card payments, real emails, AI moderation, an admin console and its own domain. A builder should be able to implement it without further input, except for the items listed under Open questions.
Reference prototype: The Throne prototype. It shows the intended look, copy and behavior with simulated payments. Where this document and the prototype disagree, this document wins.
Product goals
- Turn status into revenue: repeated takeovers, voluntary overpayment for higher titles, and dethroned kings buying back.

- Make every takeover feel like an event worth paying for: coronation animation, title, coat of arms, shareable proof.

- Run almost unattended: automatic payments, emails and moderation, with a small admin console for exceptions.

Audience
- Buyers: individuals who want to see their name on top, often on a phone, often arriving from a shared link.

- Dethroned kings: past buyers returning through the overthrow email.

- Spectators: visitors who watch, try their name on, and share.

Glossary
Term
Meaning
Throne
One public seat with its own price history. There are two: the Eternal Throne and the Daily Throne.
King
The person currently displayed on a throne. Any gender; the word is used throughout the UI.
Takeover
A successful paid purchase that makes the buyer the new king.
Reign
One king's time on one throne, from takeover until the next takeover, removal or daily reset.
Minimum price
The lowest amount the next takeover may pay. Computed by the server.
Amount paid
What the buyer actually paid. Must be at least the minimum price. Drives title and the next minimum.
Title
Rank derived from amount paid: Lord, Baron, Duke, Archduke, Emperor.
Crest
Coat of arms generated deterministically from the king's name.
Proclamation
Optional message of up to 140 characters shown under the king's name.
Reservation
A short exclusive lock on a throne's minimum price while one buyer is in checkout.
Decay
Daily price drop on the Eternal Throne when nobody buys for 24 hours.
Daily reset
Midnight UTC, when the Daily Throne becomes vacant and its price returns to the base price.
Try-on
Typing a name to preview it on the throne before paying.
Overthrow email
Email to the previous king when someone takes their seat.
Core mechanics
All prices are computed on the server in integer cents and are the single source of truth. The client only displays them. Every value below lives in a config table so an admin can change it without a deploy.
Configuration
Parameter
Default
Notes
Currency
EUR
Open question: EUR or CHF. One currency for the whole app.
Base price
€2.00
First takeover of a throne and Daily Throne after reset.
Minimum step
10%
Next minimum = amount paid × 1.10.
Decay rate
2% per full idle day
Eternal Throne only.
Decay grace
24 h
No decay before 24 h without a takeover.
Daily reset
00:00 UTC
Daily Throne only.
Maximum per takeover
€1,000,000
Hard cap on a single payment.
Reservation length
3 min
Extends to 10 min once payment confirmation has started.
Reservation heartbeat
every 20 s
Released early after 35 s without a heartbeat.
Name length
1–24 characters
After normalization (see Moderation).
Proclamation length
0–140 characters
Optional.
Minimum price
Eternal Throne, where P is the last amount paid in euros and d is the number of full 24-hour periods since the last takeover:

    min = max(€2.00, round(P × 1.10 × 0.98^d))

(Reconstructed from the original equation block; consistent with AC-02: €100 last paid → €110.00, €107.80, €105.64, €103.53 at 0/24/49/72 h.)

Daily Throne: if the last takeover happened on the current UTC date, min = round(P × 1.10). Otherwise min = €2.00. No decay.
A throne that has never been taken costs the base price. A king removed by an admin does not change the price.
Rounding: round half up to whole cents, applied once per computation. Store all amounts as integer cents.
Test vector: paying the minimum every time from €2.00 gives €2.00, €2.20, €2.42, €2.66 and so on. The 30th takeover costs €31.72, the first 30 takeovers total €328.92, and the 31st minimum is €34.89.
Choosing a higher price
- The buyer may pay any amount from the minimum up to the maximum, in whole cents.

- The amount paid, not the minimum, becomes the new P. Paying more therefore raises the next challenger's minimum.

- The minimum is locked by the buyer's reservation. A buyer with a valid reservation is never asked for more than the locked minimum.

- The same person may take a throne they already hold. This is a valid takeover at the normal minimum.

Titles
The title depends only on the amount paid for that reign.
Title
Amount paid
Lord
€2.00 to €9.99
Baron
€10.00 to €99.99
Duke
€100.00 to €999.99
Archduke
€1,000.00 to €9,999.99
Emperor
€10,000.00 and more
The hero plate reads “<Title> of the Eternal Throne” or “<Title> of the Daily Throne”. The hall of kings shows “<Title> <Name>”.
Thrones
- The two thrones are fully independent: separate price, king, reigns and statistics.

- The Eternal Throne never resets. Its statistics are all-time.

- The Daily Throne becomes vacant at 00:00 UTC. Its statistics cover the current UTC day. The hero shows “Yesterday’s ruler: <Name>” until the first takeover of the new day.

- A reign ends at the next takeover, at an admin removal, or, on the Daily Throne, at the reset.

- The king never receives money. There are no prizes, payouts, refunds for being overthrown, or rewards of monetary value.

User journeys
Five journeys cover the product. Each must work end to end on a phone without an account.
1. First visit
- Visitor lands on the Eternal Throne and sees the current king, title, proclamation and live reign timer.

- The gold button names the price and the person to overthrow, for example “Overthrow Max for €2.42”.

- Live signals show how many people are watching, when the last takeover happened and the record reign.

- Scrolling shows the price curve, the title ladder and the hall of kings.

2. Try-on to takeover
- Visitor types a name into “See your name on the throne”. The hero immediately shows that name, its crest and the title the current minimum buys, marked “Preview”.

- The button changes to “Take the throne as <Name> for €X”.

- Tapping it reserves the minimum price for 3 minutes and opens checkout with the name filled in.

- Buyer picks an amount, optionally adds a proclamation, enters email and card, and pays.

- The throne updates for everyone. The buyer sees the coronation screen with confetti, crest, title, receipt summary and share options.

3. Paying more for a higher title
- In checkout the buyer taps “Become Duke” or types an amount.

- Help text updates live: the extra over the minimum, the title gained and what the next challenger must pay.

- The pay button always shows the exact amount: “Pay €150.00 and take the throne”.

4. Dethroned king reclaims
- Someone overthrows the king. Within 60 seconds the previous king gets the overthrow email, if they opted in.

- The email names the new king and the new minimum, with a “Reclaim my throne” button.

- The link opens the right throne with checkout already open and the old name filled in.

5. Two buyers at once
- Buyer A opens checkout and gets the reservation.

- Buyer B sees “Someone is paying for this throne right now” with a countdown, and the button is disabled.

- If A pays, B sees the new king and a new, higher price. If A abandons, the lock releases within 35 seconds and B can try.

Public page
One page per throne: / for the Eternal Throne and /daily for the Daily Throne, with a switch in the header. P0 is required for launch, P1 soon after, P2 later.
Stage (hero)
ID
Requirement
Priority
FR-01
Full-width dark stage with a spotlight beam, a gold throne illustration and an ermine trim along the bottom edge. Header holds the wordmark and the Eternal / Daily switch.
P0
FR-02
The current king’s crest sits on the throne’s backrest. Vacant thrones show a neutral crest with “?”.
P0
FR-03
Reigning state: “Long live”, the name in large gold blackletter, the title plate, the proclamation in quotes, and “Reigning for 2h 14m 09s” updating every second. If the viewer is the king, prefix “That’s you.”
P0
FR-04
Vacant states: “No one has ruled yet”; “The last king was removed”; Daily Throne after reset shows “A new day has begun” and “Yesterday’s ruler: <Name>”. Name area shows “Vacant”.
P0
FR-05
When a takeover arrives live, play the coronation animation on the name (about 1.1 s). Never on first page load.
P0
FR-06
A slow gold shimmer passes across the king’s name every 7 s. Disabled with reduced motion.
P1
FR-07
“Report” link under the hero opens a short form to flag the current king’s name or proclamation.
P0
Call to action
ID
Requirement
Priority
FR-10
Gold primary button. Label rules, first match wins: viewer is king → “Crown yourself again for €X”; try-on active → “Take the throne as <Name> for €X”; king present → “Overthrow <Name> for €X”; vacant → “Claim the empty throne for €X”. X is the current minimum. Names over 16 characters are truncated with “…”.
P0
FR-11
Pitch line under the button. If the minimum buys a higher title than the current king holds: “<Name> is only a <Title>. You’d be crowned <Higher title>.” Otherwise: “You’ll be crowned <Title> of the <Throne>.”
P0
FR-12
Info line: “If you pay the minimum, the next challenger pays €Y.” Then for Eternal either the decay rule or “Untouched for N days, so the price has fallen Z%.” For Daily: “Resets to €2.00 at midnight UTC, in 5h 12m 03s.”
P0
FR-13
Static line: paying more than the minimum gives a grander title and a pricier throne for the next challenger.
P0
FR-14
While another buyer holds the reservation: disable the button and show “Someone is paying for this throne right now. Their price is locked for 2:41.”
P0
Try-on
ID
Requirement
Priority
FR-20
Input labeled “See your name on the throne” (max 24 characters). While it has text, the hero shows that name, its crest, the title the minimum buys, “Picture this” as the greeting, “This seat is yours for €X.” and a “Preview” badge. Clearing it restores the real king.
P0
FR-21
Enter in the try-on input opens checkout with the name prefilled. Try-on text never leaves the browser and is not moderated.
P0
Live signals
ID
Requirement
Priority
FR-30
Chip “N people watching right now”, shown only when N ≥ 2. N counts open browser tabs on that throne.
P1
FR-31
Chip “Last takeover 4 minutes ago” based on the most recent reign of this throne.
P0
FR-32
Chip “Record reign 5h 02m by <Name>”, shown once the record exceeds one minute.
P0
FR-33
Throne state, reservations, reigns and watcher counts update live without reload, within 2 s of the change.
P0
Price ladder and titles
ID
Requirement
Priority
FR-40
Section “The price only goes up” with a line chart of the minimum-step curve from €2.00, at least 100 steps, with a gold area fill.
P0
FR-41
Mark the current price on the curve as “You are here” with the price, one milestone 15+ steps ahead, and the final step with its price. Labels must not overlap at 360 px width.
P0
FR-42
Lead text: “Every takeover adds at least 10%. The crown started at €2.00 and costs €X now. Even at the minimum, it reaches €A by takeover #50 and €B by #100. The earlier you rule, the cheaper the crown.”
P0
FR-43
Title ladder of five steps with thresholds; the title the current minimum buys is highlighted gold.
P0
Hall of kings
ID
Requirement
Priority
FR-50
Summary line: “29 kings have paid €297.20 for this throne.” Daily version is prefixed “Today,” and counts today only.
P0
FR-51
Two record cards with crest: longest reign and highest price paid.
P0
FR-52
Recent rulers: last 12 reigns, newest first, each with crest, “<Title> <Name>”, amount, and “Reigning now, 12m so far”, “Ruled for 2h 03m” or “Removed after 4m”.
P0
FR-53
Full history page per throne with pagination, 50 reigns per page.
P2
Rest of page
ID
Requirement
Priority
FR-60
“How it works”: three short paragraphs matching the prototype, updated for real payments.
P0
FR-61
Footer links: Terms, Privacy, Imprint, Contact, Refund policy.
P0
FR-62
Crest generation must be identical on client and server (used in share images). Algorithm in Design system.
P0
Checkout and payment
Payments use Stripe with manual capture: the card is authorized first and charged only if the buyer still holds a valid reservation. Two takeovers can never collide, and a buyer who loses the race is never charged.
Checkout form
Checkout is a modal sheet over the throne page. On phones it fills the screen.
Element
Rules
Header
Live crest preview, “You’ll be crowned”, and “<Title> <Name>” updating as the name and amount change.
Price
Euro input prefilled with the minimum, two decimals. Quick buttons: Minimum, Become <next title>, ×2, ×5. Equal amounts appear once, and the title label wins. Amounts above the cap are hidden.
Price help
Live: “€148.00 above the minimum. You’ll rank as a Duke instead of a Lord. The next challenger pays €165.00.” At the minimum: “That’s the minimum.” Invalid: “The minimum is €X.” in red, pay button disabled.
Lock countdown
“Your minimum of €2.42 is locked for 2:59.”
Name
Required, 1–24 characters after normalization. Prefilled from try-on or a reclaim link.
Proclamation
Optional, 0–140 characters, with a “0 / 140” counter.
Email
Required for the receipt. Standard format validation.
Overthrow alert
Checkbox “Email me if someone takes my throne”. Default state is an open question for legal review.
Terms
Required checkbox: “I’m 18 or older. I’m buying display time, not a prize, and there’s no refund when I’m overthrown.” Links to Terms.
Payment
Stripe Payment Element. Offer only methods that support manual capture, including Apple Pay and Google Pay where available.
Pay button
“Pay €X and take the throne”. While working: “Processing payment…”.
Cancel
Closes the sheet and releases the reservation immediately.
Flow
- Open checkout. Client calls POST /api/thrones/{throne}/reservations. In one transaction the server locks the throne row, rejects with 409 if an active reservation exists, computes the minimum and stores a reservation with the throne’s current version and a 3-minute expiry. It creates a PaymentIntent for the minimum with manual capture and the reservation id in metadata, and returns the client secret, minimum and expiry.

- Keep alive. While checkout is open the client sends a heartbeat every 20 s. Without one for 35 s the server releases the reservation, unless payment has started.

- Submit. On Pay the client calls POST /api/reservations/{id}/confirm with amount, name, proclamation, email, alert opt-in and terms acceptance. The server validates the amount, normalizes and moderates the texts, updates the PaymentIntent amount, sets the reservation to paying and extends it to 10 minutes from now. The total life of a reservation never exceeds 13 minutes.

- Authorize. The client calls Stripe’s confirm payment, which handles 3-D Secure in place.

- Capture and crown. On the webhook payment_intent.amount_capturable_updated the server locks the throne row and checks: the reservation is paying and unexpired, the throne version is unchanged, and the authorized amount matches. It then captures with the reservation id as idempotency key. Only after a successful capture does it insert the reign, end the previous reign, update the throne and bump its version, all in the same transaction. Any failed check cancels the PaymentIntent instead.

- Tell everyone. After commit: broadcast the new state, send the receipt and the overthrow email.

- Show the result. The client waits for its reservation to become completed or failed through the live channel, polling every 2 s as fallback, then shows the coronation screen or the failure message.

- Reconcile. A job runs every minute. Reservations stuck in paying for over 2 minutes are checked against Stripe and finished or cancelled.

Every path except Completed ends with the PaymentIntent cancelled, so no buyer is ever charged without being crowned.
Failure handling
Situation
System behavior
Message to the buyer
Throne already reserved
409 with the lock’s end time
“Someone else is paying for this throne right now. Try again in a moment.”
Reservation expired before paying
410
“Your price lock ran out. Open checkout again to get the current price.”
Amount invalid
422
“Enter a price between €X and €1,000,000.”
Moderation rejects text
422 with a category
Category message, for example “Links aren’t allowed on the throne. Remove the link and try again.”
Moderation unavailable
503, fail closed
“We can’t check names right now. Try again in a few minutes.”
Card declined or 3-D Secure failed
Reservation stays until it expires
Stripe’s message, then “Try another card.”
Authorized, but reservation no longer valid
Cancel the authorization
“Your card wasn’t charged. Someone else took the throne first.”
Capture fails
Cancel, mark reservation failed
“Your payment didn’t go through, so the throne wasn’t taken. You weren’t charged.”
Buyer closes the tab after authorizing
Webhook still completes the takeover
Receipt email confirms it.
Duplicate webhook
Ignored by event id and reservation state
None
Rules
- Never trust a price, amount or title sent by the client. The server recomputes everything.

- At most one active or paying reservation per throne, enforced by a unique partial index, not only by code.

- At most 3 unpaid reservations per IP address and per device id in 10 minutes. After that: 429 and “Too many attempts. Try again in 10 minutes.”

- All money values are integer cents in the database and in Stripe calls.

Notifications and sharing
The overthrow email is the main repeat-revenue engine, so it must arrive fast and land in the inbox. All emails go through a transactional provider with SPF, DKIM and DMARC set up on the sending domain.
Emails
Email
Trigger
Content
Priority
Receipt
Successful capture
Throne, title, name, amount, VAT line, date and time, reign link, support contact.
P0
Overthrow
A takeover ends a reign whose king opted in
Subject “You’ve been overthrown”. Body: “<Title> <Name> just took your seat on the <throne>. Win it back for €X before they get comfortable.” Button “Reclaim my throne”. Unsubscribe link.
P0
Removal notice
Admin removes a king
Neutral notice that the reign ended under the Terms, with the reason category.
P1
Refund confirmation
Admin issues a refund
Amount and expected timing.
P1
Rules for the overthrow email:
- Send within 60 s of the takeover.

- Skip it when the new king has the same email as the old one.

- At most one overthrow email per recipient per throne per 15 minutes. Later ones in that window are dropped, not queued.

- “Reclaim my throne” links to the throne with checkout open and the old name prefilled, using a signed token valid for 7 days. The price shown is always the live minimum, never the one in the email.

- Unsubscribing stops overthrow emails for that address on all thrones.

Coronation screen
After a successful takeover, the checkout sheet turns into a celebration on the dark stage background.
- Gold confetti burst of about 2–3 s, skipped with reduced motion.

- Large crest, “Long live”, and “<Title> <Name>” in gold blackletter.

- “You paid €X for the <throne>. The next challenger pays €Y.”

- Share block with the brag text “I just took The Throne and was crowned <Title> <Name> for €X. Come and take it from me.” plus the reign link.

- Buttons: Share (native share sheet on phones), Copy link, Close.

Share pages and images
ID
Requirement
Priority
FR-70
Each reign gets a public page /r/{reignId} showing crest, title, name, proclamation, amount, throne, and reign status (“reigning now” or “ruled for 2h 03m”), with a button to the live throne.
P0
FR-71
Each reign page has an Open Graph image of 1200 × 630 px in the stage style: throne, crest, “<Title> <Name>”, amount and throne name. Generated on demand and cached.
P0
FR-72
The throne pages have their own OG image showing the current king, refreshed at least every 5 minutes.
P1
FR-73
Removed or reported-and-hidden reigns show a neutral “This reign is no longer shown” page and a generic OG image.
P0
Moderation, abuse and admin
Everything shown on the throne is checked before payment, and an admin can remove anything afterwards. Moderation fails closed: if the check cannot run, nobody can buy.
Text normalization (before any check)
- Unicode NFC normalization.

- Remove control characters, zero-width characters and bidirectional override characters. Emoji are allowed.

- Collapse whitespace to single spaces and trim.

- Reject combining-mark abuse: more than 2 combining marks on one base character.

- Enforce lengths after normalization: name 1–24, proclamation 0–140.

Automatic checks
Check
Method
Message on reject
Links, domains, email addresses, phone numbers
Regular expressions
“Links and contact details aren’t allowed on the throne. Remove them and try again.”
Banned terms list
Admin-editable list, case and accent insensitive
“That can’t go on the throne. Change it and try again.”
Policy check
LLM classifier with a fixed system prompt, 5 s timeout, JSON output of allow or deny plus category
Category-specific message, never the model’s raw text
Policy categories to deny: hate or slurs; harassment or naming of private individuals in a negative way; sexual content; violence or threats; self-harm; impersonation of real public figures or brands; spam, ads and promotions; personal data. Whether commercial names are allowed is an open question.
Store every check with input, normalized text, result, category and model version for audit.
Reports
- “Report” under the hero opens a form with a reason (offensive, impersonation, spam, other) and optional details.

- Reports go into an admin queue. Three reports on the same reign from different IPs within 10 minutes temporarily blur the proclamation for viewers until an admin decides.

Chargebacks and refunds
- On a Stripe dispute: if the disputed reign is still current, remove the king; mark the reign disputed; ban the card fingerprint and email from future purchases.

- The throne price stays where it is after a removal.

- No refunds for being overthrown. Admins can refund in exceptional cases such as a system error or a legal requirement. A refund of the current reign also removes the king.

Admin console
Separate route /admin, protected by passkey or SSO, admin role required, every action written to an audit log.
ID
Feature
Priority
AD-01
Live view of both thrones with the current king, reservation state and recent reigns.
P0
AD-02
Remove the current king with a reason category; optional email to that king.
P0
AD-03
Hide a past reign from the hall of kings and its share page.
P0
AD-04
Refund a payment, full or partial, with confirmation.
P0
AD-05
Ban by email, card fingerprint, IP or device id, with an expiry.
P0
AD-06
Report queue with approve or remove actions.
P0
AD-07
Edit configuration values, with a preview of the effect on the next minimum price.
P1
AD-08
Edit the banned terms list.
P1
AD-09
Revenue dashboard: takeovers, gross, fees, refunds and disputes per day and per throne.
P1
AD-10
Resend receipt or overthrow email.
P2
Data model
PostgreSQL is the system of record. Money is stored as integer cents, times as UTC timestamps, ids as UUIDs. The throne row is the lock for every state change on that throne.
Table
Key fields
Constraints and notes
thrones
id (eternal, daily), current_reign_id, last_paid_cents, crowned_at, removed_at, version
version increments on every change. Locked with SELECT … FOR UPDATE for reservations and captures.
reigns
id, throne_id, customer_id, name, proclamation, paid_cents, title, crest_seed, started_at, ended_at, end_reason (takeover, removed, reset, refunded, disputed), hidden, payment_id
Title stored at creation. Index on (throne_id, started_at desc).
reservations
id, throne_id, min_cents, amount_cents, throne_version, state (active, paying, completed, expired, released, failed), fail_reason, expires_at, last_heartbeat_at, client_ip_hash, device_id, payment_intent_id, name, proclamation, email, alert_opt_in, terms_accepted_at
Unique partial index on throne_id where state in ('active','paying').
payments
id, reservation_id, stripe_payment_intent_id, stripe_charge_id, amount_cents, currency, status, fee_cents, refunded_cents, disputed, card_fingerprint
Unique on stripe_payment_intent_id.
customers
id, email (normalized, unique), created_at, alert_opt_in, unsubscribed_at
No passwords; no account login in v1.
email_log
id, customer_id, type, reign_id, provider_message_id, status, sent_at
Used for the 15-minute overthrow email limit.
moderation_checks
id, reservation_id, field, raw_text, normalized_text, result, category, model, latency_ms, created_at
Kept 180 days.
reports
id, reign_id, reason, details, reporter_ip_hash, status, created_at, resolved_by, resolved_at
bans
id, kind (email, card, ip, device), value_hash, reason, expires_at, created_by
Checked at reservation and at confirm.
config
key, value, updated_by, updated_at
Values from the Configuration table. Cached for 30 s.
banned_terms
id, term, created_by
admin_users
id, email, role, passkey credentials
audit_log
id, actor, action, target, before, after, created_at
Append only.
stripe_events
event_id, type, processed_at
Unique on event_id for idempotent webhooks.
IP addresses are stored only as salted hashes. Device id is a random value in a first-party cookie, used only for abuse limits.
API and real-time
A single web app serves the pages, the JSON API, webhooks and share images. Recommended stack: Next.js on Vercel, PostgreSQL (Neon or Supabase), Redis (Upstash) for rate limits and presence, Stripe, Resend or Postmark, an LLM API for moderation, and Sentry. Equivalent choices are fine if they meet the requirements.
The browser never writes state directly: it calls the API, receives live events, and sends card details only to Stripe.
Public endpoints
Method
Path
Purpose
GET
/api/thrones/{throne}
Current king, title, proclamation, crowned time, minimum price, reservation state, today’s or all-time stats, last 12 reigns, records.
GET
/api/thrones/{throne}/reigns?cursor=
Paginated history, 50 per page.
GET
/api/reigns/{id}
One reign for the share page.
POST
/api/thrones/{throne}/reservations
Open checkout. Returns reservationId, clientSecret, minCents, expiresAt. 409 if busy, 429 if rate limited.
POST
/api/reservations/{id}/heartbeat
Keep the reservation alive.
POST
/api/reservations/{id}/confirm
Body: amountCents, name, proclamation, email, alertOptIn, termsAccepted. Validates, moderates, updates the PaymentIntent, sets state paying.
GET
/api/reservations/{id}
State and failure reason, for polling.
DELETE
/api/reservations/{id}
Cancel and release.
POST
/api/reports
Report a reign.
GET
/api/unsubscribe?token=
One-click unsubscribe from overthrow emails.
GET
/og/r/{reignId}.png, /og/{throne}.png
Share images.
Reservation calls carry a reservation token returned at creation, so only the creating browser can heartbeat, confirm or cancel.
Webhooks
POST /api/webhooks/stripe, signature verified, idempotent by event id. Handled events: payment_intent.amount_capturable_updated, payment_intent.succeeded, payment_intent.payment_failed, payment_intent.canceled, charge.refunded, charge.dispute.created, charge.dispute.closed.
Real-time channel
One channel per throne, using server-sent events or a managed service such as Ably, Pusher or Supabase Realtime.
Event
Payload
Sent when
throne.updated
Same shape as GET /api/thrones/{throne}
Takeover, removal, daily reset, config change
reservation.updated
state, lockedUntil (no buyer data)
Reservation created, extended, ended
presence.count
watching
Viewer count changes, at most once per 2 s
reservation.result
reservationId, state, failReason
Private to the buyer’s connection
The client also refetches the throne every 30 s and on tab focus, so a missed event never leaves the page stale for long.
Scheduled jobs
Job
Schedule
Action
Expire reservations
Every 10 s
Expire overdue ones, release silent ones, cancel their PaymentIntents.
Reconcile payments
Every minute
Finish or cancel reservations stuck in paying for over 2 minutes.
Daily reset
00:00 UTC
End the Daily Throne reign with reason reset and broadcast.
Retention
Daily
Delete moderation records older than 180 days and expired bans.
Non-functional requirements
Correctness of money and of who holds the throne comes before everything else, including speed.
Area
Requirement
Correctness
Zero double takeovers and zero charges without a takeover. Covered by automated concurrency tests (see Acceptance criteria).
Performance
Throne page first contentful paint under 1.5 s on a mid-range phone over 4G. API p95 under 300 ms excluding Stripe and moderation calls.
Live updates
Takeovers visible to all viewers within 2 s (p95).
Moderation latency
Under 3 s p95; hard timeout 5 s.
Load
2,000 concurrent viewers per throne and 20 checkout attempts per minute without degradation.
Availability
99.5% monthly for the public page. Payments may pause during incidents, but must never charge without crowning.
Security
HTTPS only, HSTS, strict content security policy, CSRF protection on mutating routes, Stripe webhook signature checks, secrets in the platform’s secret store, admin behind passkey or SSO. Card data never touches our servers.
Privacy
Collect only email, names and proclamations as entered, payment metadata, hashed IP and device id. Public display shows only name, proclamation, title, amount and times, never email. Data export and deletion on request.
Accessibility
WCAG 2.2 AA: keyboard navigation, visible focus, labels on all inputs, dialog focus trap, live region for throne changes, 4.5:1 text contrast, reduced motion respected (no shimmer, no confetti, no coronation animation).
Responsive
Works from 320 px width. Safe-area insets on phones with notches. Checkout fills the screen under 480 px.
Themes
Light and dark via the system setting. The stage and coronation screen are always dark.
Localization
English copy at launch. All strings in a translation file. Currency and dates formatted with the browser’s locale.
Observability
Error tracking, structured logs with reservation id, alerts on webhook failures, on reservations stuck in paying, and on moderation errors above 5% in 10 minutes.
Backups
Daily database backups kept 30 days; point-in-time recovery enabled.
Design system
The look is royal theater: a dark lapis stage, gold, ermine fur and blackletter. Match the prototype’s tokens below; spend the boldness on the stage and keep the rest of the page quiet.
Color tokens
Token
Light
Dark
Use
--bg
#EEF0F8
#0A0D28
Page background below the stage
--surface
#FFFFFF
#141943
Cards, inputs, chips
--ink
#141731
#ECEBF7
Body text
--muted
#555A78
#A4A8C8
Secondary text
--line
#D6D9E8
#283068
Borders
--accent
#8F620F
#F2C75C
Gold text on page background
--crimson / --crimson-bg
#9E1F37 / #F7E3E8
#F2869A / #35122A
Notices and errors
--stage
#121A5C
#121A5C
Stage, checkout header, coronation screen
--on-stage / --on-stage-soft
#F5F4FB / #BFC4EA
same
Text on the stage
Gold ramp
#FFE7A0, #E2B04A, #9C6B12, ink #231803
same
Button, plate, throne, chips
Ermine
#FFFFFF with #15151B spots
#E6E5EF with #15151B spots
Trim under the stage
Typography
- Display: UnifrakturMaguntia (Google Fonts) for the wordmark, king’s name, crest initials and coronation title. King’s name scales from 3 rem to 6 rem with viewport width.

- Everything else: Schibsted Grotesk 400–800. Tabular figures for all prices and timers.

- Sentence case everywhere. No all-caps labels.

Key components
- Stage: dark lapis with a trapezoid spotlight beam from the top, a soft floor glow, and the throne SVG (gold gradients, crimson velvet, ruby and sapphire studs) with the crest on the backrest.

- Title plate: small gold bar under the name.

- Primary button: gold gradient, 16 px radius, a 6 px darker bottom edge that compresses on press, crown icon before the label.

- Chips: rounded pills for live signals; price quick buttons show a small label over the amount, and the selected one turns gold.

- Price chart: gold line with a fading gold area, a dashed leader from the current point up to “You are here”.

- Title ladder: five equal steps; the current one is gold.

Crest algorithm
Deterministic so client, server and share images draw the same crest.
- Hash the lowercased name with 32-bit FNV-1a over Unicode code points.

- Field color: [#A3243B, #22409A, #1E6B47, #5B2A86, #1A1A22, #B4561C][h mod 6].

- Second color: gold #E2B04A if (h >>> 4) mod 2 is 1, else silver #F4F2EA.

- Division by (h >>> 7) mod 5: plain, per pale (right half), per fess (top 40%), per bend (upper-right triangle), chevron.

- Shield path in a 100 × 120 box: M6 6H94V58C94 92 72 108 50 116 28 108 6 92 6 58Z, gold outline 5 units.

- Gold roundel radius 21 at (50, 56) with the name’s first character uppercased in blackletter.

- Vacant throne: field #3A4280, plain, “?”.

Motion
Moment
Spec
Reduced motion
Name shimmer
Gold highlight sweeps across the name, 7 s loop with a pause
Off
Coronation
Scale 0.85 to 1.05 to 1 with fade-in, 1.1 s, only on a live takeover
Off
Confetti
About 80 gold, cream and crimson pieces falling 1.7–3.2 s
Off
Button press
4 px down, 80 ms
Off
Copy deck
Key
Text
Greeting, reigning
Long live
Greeting, try-on
Picture this
Try-on label
See your name on the throne
Reign line
Reigning for {duration}
Locked notice
Someone is paying for this throne right now. Their price is locked for {m:ss}.
Extra-pay hint
Pay more than the minimum at checkout to get a grander title and make the throne pricier for the next challenger.
Checkout heading
Take the {eternal throne / daily throne}
Coronation
Long live {Title} {Name}
Overthrow subject
You’ve been overthrown
Overthrow button
Reclaim my throne
Duration formats: “41s”, “12m 03s”, “2h 14m 09s”, “3d 4h 05m”. Relative times: “just now”, “4 minutes ago”, “2 hours ago”, “3 days ago”.
Legal and compliance
These are product requirements to check with a lawyer and tax advisor in the operator’s jurisdiction before launch. They are not legal advice. The builder must implement the hooks (checkboxes, pages, logs) so the answers can be applied without code changes where possible.
Topic
Why it matters
What the product must support
Nature of the purchase
Payouts to previous kings or prizes could make this a lottery, gambling or an investment scheme.
Never pay anyone out. Terms describe the purchase as display time with no guaranteed duration.
Right of withdrawal
EU consumers generally have a withdrawal right for digital services unless they agree to immediate performance and acknowledge losing it.
Checkbox text confirming immediate performance, wording supplied by legal; timestamp stored with the reservation.
VAT on digital services
VAT is often due where the customer is located, which may require registrations such as the EU One-Stop Shop.
Store customer country (from card and IP), show VAT on receipts, export per-country revenue. Stripe Tax is one option.
Payment provider acceptance
Unusual business models can be refused or frozen.
Confirm with Stripe before launch. Keep the refund and dispute flows ready.
Overthrow email consent
It invites a repeat purchase, so it may count as marketing.
Opt-in checkbox with legal-approved default, one-click unsubscribe, consent timestamp.
User content on display
Hosting public text brings notice-and-takedown duties in many places.
Report button, admin decisions with reasons, removal notice email, contact point in the imprint.
Impersonation and personality rights
Buyers may use real people’s or brands’ names.
Moderation category for impersonation, fast removal, terms forbidding it.
Privacy
Email and payment data are personal data.
Privacy policy, processor agreements, data export and deletion, hashed IPs, no tracking cookies without consent.
Age
Minors could buy impulsively.
18+ confirmation in checkout and terms.
Imprint
Required for commercial sites in several countries.
Imprint page with operator details.
Analytics
Use cookieless, privacy-friendly product analytics. Revenue numbers come from the database, not from the analytics tool.
Events
Event
Properties
page_view
throne, referrer type (direct, share page, overthrow email, other)
tryon_started
throne
checkout_opened
throne, source (button, try-on, reclaim link), min price
checkout_busy
throne
quick_price_tapped
label (minimum, title, ×2, ×5)
payment_submitted
throne, amount, overpay %
moderation_rejected
field, category
takeover_completed
throne, amount, overpay %, title, was previous king (yes or no)
takeover_failed
throne, reason
share_clicked
method (native, copy)
overthrow_email_clicked
throne, minutes since overthrow
KPIs
KPI
Definition
Takeovers per day
Completed takeovers across both thrones per UTC day
Gross revenue per day
Captured amounts minus refunds
Overpay rate
Share of takeovers paying above the minimum
Average overpay
Mean of (amount ÷ minimum − 1)
Checkout conversion
Completed takeovers ÷ checkouts opened
Try-on conversion
Takeovers with source try-on ÷ try-ons started
Reclaim rate
Overthrown kings who take any throne again within 7 days ÷ overthrown kings with alerts on
Share rate
Share clicks ÷ takeovers
Moderation reject rate
Rejected submissions ÷ submissions
Dispute rate
Disputes ÷ captured payments, alert above 0.5%
Acceptance criteria
Launch requires every scenario below to pass as an automated test, using Stripe test mode and a fake clock where time matters.
ID
Given
When
Then
AC-01
A new Eternal Throne
30 buyers each pay the minimum
Prices are €2.00, €2.20, €2.42 … €31.72; total €328.92; next minimum €34.89.
AC-02
Last paid €100.00 on Eternal
0, 24, 49 and 72 hours pass with no takeover
Minimum is €110.00, €107.80, €105.64, €103.53.
AC-03
Eternal last paid €2.00, 10 days idle
A buyer opens checkout
Minimum is €2.00 (floor), not lower.
AC-04
Daily Throne crowned at 23:59 UTC
The clock passes 00:00 UTC
Throne shows vacant with “Yesterday’s ruler”, minimum €2.00, today’s stats at zero.
AC-05
Minimum €2.42
Buyer pays €150.00
Reign title Duke; next minimum €165.00; hall shows “Duke <Name>”.
AC-06
Minimum €2.42
Client sends €2.41 or €1,000,000.01
422; no PaymentIntent change; nothing charged.
AC-07
Buyer A holds a reservation
Buyer B opens checkout
B gets 409 and sees the locked notice with a countdown.
AC-08
50 parallel reservation requests
They arrive within 100 ms
Exactly one succeeds.
AC-09
A authorizes, then A’s reservation expires and B takes the throne
A’s webhook arrives
A’s authorization is cancelled, A is not charged, B stays king.
AC-10
A buyer completes 3-D Secure
Webhook arrives twice
One capture, one reign, one receipt.
AC-11
Webhook is never delivered
2 minutes pass
Reconcile job finishes the takeover from the Stripe state.
AC-12
Buyer closes checkout
Without paying
Reservation released at once; others can buy within 2 s.
AC-13
Browser crashes in checkout
No heartbeat for 35 s
Reservation released.
AC-14
Name contains a link or a slur
Buyer submits
422 with the category message; no charge; check logged.
AC-15
Moderation API is down
Buyer submits
503 message; no reservation moves to paying.
AC-16
King opted in to alerts
Someone overthrows them
Overthrow email sent within 60 s with a working reclaim link.
AC-17
Same recipient overthrown 3 times in 10 minutes
—
Only the first overthrow email is sent.
AC-18
A dispute opens on the current reign
Webhook arrives
King removed, reign marked disputed, card fingerprint banned, price unchanged.
AC-19
Two viewers on the same throne
One completes a takeover
The other sees the new king and coronation animation within 2 s.
AC-20
Reduced motion enabled
A takeover happens
No shimmer, coronation or confetti; content still updates.
AC-21
Keyboard only
User completes a test takeover
Every control reachable, focus visible, dialog traps focus and returns it on close.
AC-22
A reign page is shared
Link pasted into a messenger
Preview shows the OG image with crest, title and name.
Milestones, scope and open questions
Build in four phases. Each phase ends only when its exit check passes.
- Core loop in test mode. Data model, pricing engine, reservations, Stripe test payments with manual capture, live updates, the public page and checkout. Exit: AC-01 to AC-13 and AC-19 pass.

- Safety. Normalization, moderation, reports, bans, admin console P0 features, disputes and refunds. Exit: AC-14, AC-15 and AC-18 pass; an admin can remove a king in under a minute.

- Growth loop. Receipt and overthrow emails, reclaim links, coronation screen, share pages and OG images, analytics. Exit: AC-16, AC-17 and AC-22 pass.

- Launch readiness. Legal pages, VAT setup, accessibility audit, load test, monitoring and alerts, live Stripe keys. Exit: all acceptance criteria pass and every open question below is answered.

Out of scope for v1
- User accounts and logins for buyers.

- More than two thrones, regional or themed thrones.

- Images, avatars or links on the throne.

- Payouts, prizes, auctions with bidding, or any secondary market.

- Push notifications and native apps.

- Currencies other than the one chosen at launch.

Open questions
- Currency: EUR or CHF, and is a single currency enough for launch?

- Legal entity and jurisdiction of the operator, which decides VAT, imprint and terms.

- Default state of the overthrow alert checkbox, and whether the email counts as marketing.

- Are company and brand names allowed on the throne, and at what price, or are they banned?

- Maximum amount per takeover: keep €1,000,000 or lower it, and should large payments need extra verification?

- Domain name and sender address for emails.

- Which LLM and policy prompt to use for moderation, and who reviews borderline reports?

- Has Stripe confirmed the business model is acceptable?

