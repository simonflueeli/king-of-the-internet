# The Throne

People pay to put their name on a public throne until someone pays at least 10% more.
Product spec: [docs/PRD.md](docs/PRD.md). Architecture, ownership and contracts:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Visual reference: [docs/prototype.html](docs/prototype.html).

Stack: Next.js 16 (App Router, TypeScript strict), Drizzle ORM on PostgreSQL or embedded PGlite,
Stripe (or a built-in fake), Vitest.

## Run locally

Requires Node 22 and npm. No database, Stripe or email account is needed for development.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. Without `DATABASE_URL` the app uses embedded PGlite stored in `.data/pglite`,
created and migrated on first use. Without `STRIPE_SECRET_KEY` payments run in fake mode.

To override settings, copy `.env.example` to `.env.local` and edit it. The defaults there are meant for
local development (fake payments, no LLM moderation, admin dev login, dev outbox).

### Environment variables

Every variable is optional in development; see `.env.example` for the full list with comments.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Unset → embedded PGlite in `.data/pglite` (in memory under tests). |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe mode (see below). Unset secret key → fake payments. |
| `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL` | Real email via Resend. Unset key → dev outbox. `SUPPORT_EMAIL` defaults to the `EMAIL_FROM` address. |
| `ANTHROPIC_API_KEY`, `MODERATION_LLM` | LLM policy check. Without a key moderation fails closed (503) unless `MODERATION_LLM=disabled` (development only: regex and banned terms only). |
| `APP_URL` | Absolute base URL for email links, OG images and the CSRF origin check. Default `http://localhost:3000`. |
| `HASH_SALT`, `TOKEN_SECRET` | Salt for hashed IPs/devices/bans and HMAC secret for reclaim/unsubscribe links. Required in production. |
| `CRON_SECRET` | Bearer token for `GET /api/cron/{expire,reconcile,daily-reset,retention}`. |
| `JOBS_INPROCESS` | `1` (default) runs the jobs on in-process timers; `0` relies on the cron routes only. |
| `ADMIN_EMAILS`, `ADMIN_BOOTSTRAP_TOKEN`, `ADMIN_DEV_LOGIN` | Admin console access (see below). |
| `NEXT_PUBLIC_MOCK_API` | `1` routes the UI to the in-browser mock API, even in a production build. |

### Payments: fake vs Stripe mode

- **Fake mode** (no `STRIPE_SECRET_KEY`): no network. Checkout shows a test-card panel with "Succeed" and
  "Decline"; they call `POST /api/dev/fake-pay/{reservationId}`, which runs the same capture-and-crown code
  path as the Stripe webhook. Fake intents live in memory, so a dev-server restart forgets them (open
  reservations then just expire).
- **Stripe mode** (`STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY`): PaymentIntents with manual capture and
  automatic payment methods without redirects (cards, Apple Pay, Google Pay, Link). Point a webhook at
  `/api/webhooks/stripe` with `STRIPE_WEBHOOK_SECRET` (locally: `stripe listen --forward-to
  localhost:3000/api/webhooks/stripe`). Events used: `payment_intent.amount_capturable_updated`,
  `.succeeded`, `.payment_failed`, `.canceled`, `charge.refunded`, `charge.dispute.created`, `.closed`.
  If a webhook never arrives, the reconcile job finishes the takeover from Stripe's state after 2 minutes.

### Admin console (`/admin`)

Admins are the addresses in `ADMIN_EMAILS` and sign in with a passkey; the first passkey is registered with
`ADMIN_BOOTSTRAP_TOKEN`. In development, `ADMIN_DEV_LOGIN=1` adds a one-click "Development login" button
on `/admin/login` (localhost only, never in production).

### Dev outbox (`/dev/outbox`)

Without `RESEND_API_KEY`, every email (receipt, overthrow, removal, refund) is logged in `email_log` and
written as HTML to `.data/outbox/`. `/dev/outbox` lists them, renders each one and can simulate an
overthrow. Not available in production.

### UI without the server API (`?mock=1`)

In development, open any throne page with `?mock=1` (sticky for the tab) to run the whole UI against an
in-browser simulation of the API: no database or server state involved. Useful for UI work; the real
flow needs no flag.

### End-to-end check

With the dev server running on the `.env.example` defaults, run:

```bash
npm run e2e
```

It drives the real HTTP API: reserve → confirm → fake-pay → the king is shown; a second buyer overthrows
the first and the overthrow email appears in the dev outbox; the reclaim link redirects to checkout with
the old name; `/r/{id}` and `/og/r/{id}` render; a report is accepted; admin dev login works and removing
the king leaves the price unchanged. It uses fresh names each run, so it works on an existing database.
Set `E2E_BASE_URL` when the server is not on `http://localhost:3000`.

### With Postgres instead of PGlite

```bash
docker compose up -d
```

Then set `DATABASE_URL=postgres://throne:throne@localhost:5432/throne` in `.env.local`. Migrations run
automatically on first use, or explicitly with `npm run db:migrate`.

To start over with a fresh local PGlite database, stop the dev server and delete the `.data/pglite` folder.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 3000 |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (unit + integration on in-memory PGlite) |
| `npm run e2e` | End-to-end check against a running dev server (`scripts/e2e.ts`) |
| `npm run db:generate` | Generate a SQL migration in `drizzle/` from `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations and seed rows to `DATABASE_URL` or local PGlite |

Do not run `next build` while `next dev` is using the same `.data/pglite` folder: PGlite is single-process.

## Layout

- `src/lib`: isomorphic pure code (contracts, pricing, crest, formatting, copy, normalization).
- `src/server`: server-only code (db, clock, config, bus, hashing, http helpers, payments, throne logic,
  moderation, notifications).
- `src/app`: pages and API routes. `src/proxy.ts` sets the `kti_device` cookie.
- `drizzle/`: generated SQL migrations.

Money is integer cents, times are UTC, and the server is the source of truth for prices.
