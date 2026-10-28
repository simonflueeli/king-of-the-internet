# F (foundation) hand-over — branch claude/ws-foundation-9f6165

Verified on Windows 11 / Node 22.13: `npm install`, `npm run typecheck`, `npm run lint`, `npm test`
(6 files, 43 tests), `npm run build`, `npm run dev` (GET / → 200, `.data/pglite` created + migrated,
`kti_device` cookie set), `npm run db:migrate`.

## Contract deviations (ARCHITECTURE.md updated; see its "Database" subsections)
1. `src/middleware.ts` → `src/proxy.ts` (Next 16 renamed middleware to proxy; Node runtime; export `proxy`).
2. No sync `db` export: `const db = await getDb()` (migrations run on first use). Also `createTestDb()`,
   `setTestDb()`, `closeDb()`, types `Database`, `Tx`, `DbOrTx`.
3. Extra nullable/defaulted columns: reservations.paying_at / source / reign_id, created_at/updated_at,
   customers.alert_opt_in_at, payments.card_country, email_log.throne_id.
4. Cache Components OFF. DB-reading pages: `await connection()` from next/server.

## Gotchas for every workstream
- Inside `db.transaction(async (tx) => …)` use ONLY `tx`. Touching getDb()/outer db (incl. getConfig() with a
  cold cache, getThroneState) inside a tx throws on PGlite ("Use the transaction's tx"). Call
  getConfig() before opening the tx; broadcast/notify after it resolves.
- Use `now()` from src/server/clock.ts, never `new Date()`, for anything time-sensitive (tests use setNow/advance).
- Tests: `beforeEach(async () => setTestDb(await createTestDb()))` gives an isolated in-memory DB (~1 s).
- Drizzle casing is snake_case; new schema sections go at the bottom of schema.ts under `// === <letter>: … ===`,
  then `npm run db:generate -- --name <letter>_<what>`.
- formatMoney without `locale` uses runtime locale → hydration mismatch risk on server-rendered text.
- next/font exposes `--font-blackletter` / `--font-sans`; use tokens `var(--blackletter)` / `var(--sans)`.

## Per workstream
- C: state.ts and admin-ops.ts already work against the DB (tested) — take ownership/rewrite freely.
  instrumentation.ts has an empty `registerJobs()` to fill. FakePaymentProvider has authorize()/decline().
  `paymentMode()` + `setPaymentProvider()` in provider.ts. Stripe impl is untested against Stripe.
- U: replace src/app/page.tsx + page.module.css (placeholder). Tokens in globals.css match the prototype.
  `crestGroup(name, {idPrefix})` returns the <g> for the throne backrest (transform="translate(70 42) scale(.6)").
- S: moderation/bans/disputes stubs; normalize.ts basic version; config.updateConfig(patch, actor) for AD-07.
- G: notifications stubs; hash.signToken/verifyToken(purpose, …) for reclaim/unsubscribe; analytics.track no-op.
