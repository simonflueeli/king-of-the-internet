// End-to-end smoke test against a running dev server (fake payments, MODERATION_LLM=disabled,
// ADMIN_DEV_LOGIN=1 — the defaults in .env.example). Works on an existing database: every run uses
// fresh names and emails and waits out a lock left by an earlier run.
//
//   npm run dev                      (in another terminal, with .env.local copied from .env.example)
//   npm run e2e                      (E2E_BASE_URL defaults to http://localhost:3000)
//
// Checks: reserve → confirm → fake-pay → king shown; a second buyer overthrows the first and the dev
// outbox has the overthrow email; /api/reclaim → 302 ?checkout=1&name=; /r/{id} and /og/r/{id} → 200;
// /api/reports → 201; admin dev login; removing the king leaves the price unchanged.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUTBOX_DIR = process.env.E2E_OUTBOX_DIR ?? path.join(process.cwd(), ".data", "outbox");
const RUN = Date.now().toString(36);
const THRONE = "eternal";

let ipSeq = Math.floor(Math.random() * 200);
/** A fresh client IP per buyer so the 3-per-10-minutes reservation limit never trips. */
const freshIp = () => `10.${(ipSeq = (ipSeq + 1) % 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}

function must<T>(label: string, value: T | null | undefined, detail?: unknown): T {
  if (value === null || value === undefined) {
    check(label, false, detail);
    throw new Error(`cannot continue: ${label}`);
  }
  return value;
}

interface Res<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Headers;
}

async function call<T = Record<string, unknown>>(
  method: string,
  pathname: string,
  opts: { body?: unknown; token?: string; ip?: string; cookie?: string; redirect?: RequestRedirect } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = { origin: BASE };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers["x-reservation-token"] = opts.token;
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: opts.redirect ?? "follow",
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // HTML or empty
  }
  return { status: res.status, body: body as T, headers: res.headers };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Reservation {
  reservationId: string;
  reservationToken: string;
  minCents: number;
  paymentMode: string;
}

/** Reserve, waiting (up to 60 s) for a lock held by someone else — e.g. left over from an earlier run. */
async function reserve(ip: string): Promise<Reservation> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const r = await call<Reservation & { error?: string; lockedUntil?: string }>("POST", `/api/thrones/${THRONE}/reservations`, { body: { source: "button" }, ip });
    if (r.status === 201) return r.body;
    if (r.status !== 409 || Date.now() > deadline) throw new Error(`reserve failed: ${r.status} ${JSON.stringify(r.body)}`);
    await sleep(2_000);
  }
}

async function takeOver(name: string, email: string) {
  const ip = freshIp();
  const r = await reserve(ip);
  const confirm = await call("POST", `/api/reservations/${r.reservationId}/confirm`, {
    token: r.reservationToken,
    ip,
    body: { amountCents: r.minCents, name, proclamation: "Long may I reign", email, alertOptIn: true, termsAccepted: true },
  });
  check(`${name}: confirm → paying`, confirm.status === 200 && confirm.body.state === "paying", confirm.body);
  const paid = await call<{ state: string; reignId: string | null }>("POST", `/api/dev/fake-pay/${r.reservationId}`, {
    token: r.reservationToken,
    ip,
    body: { outcome: "succeed" },
  });
  check(`${name}: fake-pay → completed`, paid.status === 200 && paid.body.state === "completed", paid.body);
  const state = await call<{ king: { name: string; id: string } | null; minCents: number }>("GET", `/api/thrones/${THRONE}`);
  check(`${name}: shown as king`, state.body.king?.name === name, state.body.king);
  return { reignId: must(`${name}: reign id`, paid.body.reignId), paidCents: r.minCents };
}

interface OutboxMeta {
  type: string;
  to: string;
  subject: string;
  text: string;
  createdAt: string;
}

async function findOutbox(pred: (m: OutboxMeta) => boolean, timeoutMs = 20_000): Promise<OutboxMeta | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = await readdir(OUTBOX_DIR).catch(() => [] as string[]);
    for (const f of files.filter((x) => x.endsWith(".json"))) {
      const meta = JSON.parse(await readFile(path.join(OUTBOX_DIR, f), "utf8")) as OutboxMeta;
      if (pred(meta)) return meta;
    }
    await sleep(500);
  }
  return null;
}

async function main(): Promise<void> {
  console.log(`e2e against ${BASE} (run ${RUN})`);

  const cfg = await call<{ paymentMode: string }>("GET", "/api/config/public");
  must("server reachable", cfg.status === 200 ? cfg : null, cfg.status);
  if (cfg.body.paymentMode !== "fake") throw new Error("the e2e script needs fake payments (unset STRIPE_SECRET_KEY)");

  console.log("1. first takeover");
  const aliceName = `Alice ${RUN}`;
  const aliceEmail = `alice.${RUN}@e2e.test`;
  await takeOver(aliceName, aliceEmail);

  console.log("2. overthrow + email");
  const bobName = `Bob ${RUN}`;
  const bob = await takeOver(bobName, `bob.${RUN}@e2e.test`);
  const overthrow = await findOutbox((m) => m.type === "overthrow" && m.to === aliceEmail);
  check("dev outbox has the overthrow email for the first king", overthrow !== null);
  check("overthrow email names the new king", !!overthrow?.text.includes(bobName));
  const outboxPage = await call<string>("GET", "/dev/outbox");
  check("/dev/outbox lists it", outboxPage.status === 200 && String(outboxPage.body).includes(aliceEmail), outboxPage.status);

  console.log("3. reclaim link");
  const token = must("reclaim link in the email", /\/api\/reclaim\?token=([^\s"&<]+)/.exec(overthrow?.text ?? "")?.[1]);
  const reclaim = await call("GET", `/api/reclaim?token=${token}`, { redirect: "manual" });
  const location = new URL(reclaim.headers.get("location") ?? "/", BASE);
  check("/api/reclaim → 302", reclaim.status === 302, reclaim.status);
  check(
    "redirect opens checkout with the old name",
    location.searchParams.get("checkout") === "1" && location.searchParams.get("name") === aliceName,
    location.toString(),
  );

  console.log("4. share page and OG image");
  const share = await call("GET", `/r/${bob.reignId}`);
  check(`/r/${bob.reignId} → 200`, share.status === 200, share.status);
  const og = await fetch(`${BASE}/og/r/${bob.reignId}`);
  check(`/og/r/${bob.reignId} → 200 image`, og.status === 200 && (og.headers.get("content-type") ?? "").startsWith("image/"), {
    status: og.status,
    type: og.headers.get("content-type"),
  });
  await og.arrayBuffer();

  console.log("5. report");
  const report = await call("POST", "/api/reports", { ip: freshIp(), body: { reignId: bob.reignId, reason: "spam", details: `e2e ${RUN}` } });
  check("/api/reports → 201", report.status === 201, report.body);

  console.log("6. admin");
  const login = await call("POST", "/api/admin/auth/dev-login");
  check("admin dev login → 200", login.status === 200, login.body);
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const me = await call("GET", "/api/admin/me", { cookie });
  check("admin session works", me.status === 200, me.body);
  const before = await call<{ minCents: number; king: { id: string } | null }>("GET", `/api/thrones/${THRONE}`);
  const removed = await call("POST", `/api/admin/thrones/${THRONE}/remove`, {
    cookie,
    body: { reignId: bob.reignId, reasonCategory: "other", notify: false },
  });
  check("admin removes the king → 200", removed.status === 200, removed.body);
  const after = await call<{ minCents: number; king: unknown; vacancy: { reason: string } | null }>("GET", `/api/thrones/${THRONE}`);
  check("throne is vacant (removed)", after.body.king === null && after.body.vacancy?.reason === "removed", after.body.vacancy);
  check("price unchanged after removal", after.body.minCents === before.body.minCents, {
    before: before.body.minCents,
    after: after.body.minCents,
  });

  console.log(failures ? `\n${failures} check(s) failed` : "\nall e2e checks passed");
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error(`\ne2e aborted: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
