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

To override settings, copy `.env.example` to `.env.local` and edit it.

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
