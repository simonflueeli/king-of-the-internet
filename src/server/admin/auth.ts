// OWNER: S. Admin authentication (PRD "Admin console": passkey, admin role, audit log).
//   - Admins are the emails in ADMIN_EMAILS (admin_users rows are created on first use; removing an
//     email from the env revokes access on the next request).
//   - Passkeys via WebAuthn (@simplewebauthn/server). An admin without a passkey registers the first
//     one with ADMIN_BOOTSTRAP_TOKEN; further passkeys need a signed-in session.
//   - ADMIN_DEV_LOGIN=1 allows a one-click login outside production when the request host is localhost.
//   - Sessions: random token in the httpOnly cookie `kti_admin`; admin_sessions.id = sha256(token).
//   - WebAuthn challenges travel in a short-lived signed, httpOnly cookie (no table needed).
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { and, eq, gt, lt } from "drizzle-orm";
import { copy } from "@/lib/copy";
import { now as clockNow } from "../clock";
import { getDb } from "../db/client";
import { adminCredentials, adminSessions, adminUsers, auditLog } from "../db/schema";
import { hashToken, randomToken, safeEqual, signToken, verifyToken } from "../hash";
import { getCookie, HttpError } from "../http";

export const ADMIN_COOKIE = "kti_admin";
const CHALLENGE_COOKIE = "kti_admin_challenge";
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
const CHALLENGE_MS = 5 * 60 * 1000;

export interface AdminIdentity {
  id: string;
  email: string;
  role: string;
}

// ---------------------------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------------------------

export function adminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(email.trim().toLowerCase());
}

function appUrl(): URL {
  try {
    return new URL(process.env.APP_URL || "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Hostname without port from a Host header value. */
function hostname(host: string | null): string | null {
  if (!host) return null;
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

export function isLocalHost(host: string | null): boolean {
  const h = hostname(host);
  return !!h && (LOCAL_HOSTS.has(h) || h.endsWith(".localhost"));
}

/** One-click dev login: ADMIN_DEV_LOGIN=1, not production, request host is localhost. */
export function devLoginAllowed(host: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ADMIN_DEV_LOGIN === "1" && env.NODE_ENV !== "production" && isLocalHost(host) && adminEmails(env).length > 0;
}

/** WebAuthn relying party: APP_URL, or the localhost origin the request came from in development. */
function relyingParty(req: Request): { rpID: string; origin: string } {
  const app = appUrl();
  const host = req.headers.get("host");
  if (process.env.NODE_ENV !== "production" && isLocalHost(host)) {
    const origin = req.headers.get("origin") ?? `http://${host}`;
    return { rpID: hostname(host)!.replace(/^\[|\]$/g, ""), origin };
  }
  return { rpID: app.hostname, origin: app.origin };
}

// ---------------------------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------------------------

function cookie(name: string, value: string, maxAgeS: number, path = "/"): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `Max-Age=${maxAgeS}`, "HttpOnly", "SameSite=Strict"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export const clearSessionCookie = () => cookie(ADMIN_COOKIE, "", 0);

// ---------------------------------------------------------------------------------------------
// Users and sessions
// ---------------------------------------------------------------------------------------------

export async function ensureAdminUser(email: string): Promise<AdminIdentity> {
  const normalized = email.trim().toLowerCase();
  const db = await getDb();
  await db.insert(adminUsers).values({ email: normalized, role: "admin" }).onConflictDoNothing();
  const [u] = await db.select().from(adminUsers).where(eq(adminUsers.email, normalized));
  return { id: u.id, email: u.email, role: u.role };
}

/** Creates a session and returns the Set-Cookie header value. */
export async function createSession(admin: AdminIdentity, method: string, ip?: string): Promise<string> {
  const token = randomToken(32);
  const db = await getDb();
  const at = clockNow();
  await db.transaction(async (tx) => {
    await tx.delete(adminSessions).where(lt(adminSessions.expiresAt, at)); // housekeeping
    await tx.insert(adminSessions).values({
      id: hashToken(token),
      adminUserId: admin.id,
      expiresAt: new Date(at.getTime() + ADMIN_SESSION_MS),
    });
    await tx.insert(auditLog).values({ actor: admin.email, action: "admin.login", target: admin.id, after: { method, ip: ip ?? null } });
  });
  return cookie(ADMIN_COOKIE, token, ADMIN_SESSION_MS / 1000);
}

/** The admin for a session token, or null (expired, unknown, or no longer in ADMIN_EMAILS). */
export async function adminFromToken(token: string | null | undefined): Promise<AdminIdentity | null> {
  if (!token || token.length > 200) return null;
  const db = await getDb();
  const [row] = await db
    .select({ id: adminUsers.id, email: adminUsers.email, role: adminUsers.role })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
    .where(and(eq(adminSessions.id, hashToken(token)), gt(adminSessions.expiresAt, clockNow())));
  if (!row || row.role !== "admin" || !isAdminEmail(row.email)) return null;
  return row;
}

/** For /api/admin/** route handlers: the signed-in admin or 401. */
export async function requireAdmin(req: Request): Promise<AdminIdentity> {
  const admin = await adminFromToken(getCookie(req, ADMIN_COOKIE));
  if (!admin) throw new HttpError(401, "unauthorized", copy.safety.admin.signedOut);
  return admin;
}

export async function endSession(token: string | null, actor: string | null): Promise<void> {
  if (!token) return;
  const db = await getDb();
  await db.delete(adminSessions).where(eq(adminSessions.id, hashToken(token)));
  if (actor) await db.insert(auditLog).values({ actor, action: "admin.logout" });
}

// ---------------------------------------------------------------------------------------------
// WebAuthn
// ---------------------------------------------------------------------------------------------

interface ChallengePayload {
  challenge: string;
  kind: "register" | "login";
  adminUserId?: string;
}

function challengeCookie(p: ChallengePayload): string {
  return cookie(CHALLENGE_COOKIE, signToken("admin-webauthn", p, CHALLENGE_MS), CHALLENGE_MS / 1000, "/api/admin/auth");
}

function readChallenge(req: Request, kind: ChallengePayload["kind"]): ChallengePayload {
  const raw = getCookie(req, CHALLENGE_COOKIE);
  const p = raw ? verifyToken<ChallengePayload>("admin-webauthn", raw) : null;
  if (!p || p.kind !== kind) throw new HttpError(400, "challenge_expired", copy.safety.admin.passkeyFailed);
  return p;
}

const clearChallenge = () => cookie(CHALLENGE_COOKIE, "", 0, "/api/admin/auth");

export async function registrationOptions(
  req: Request,
  input: { email: string; bootstrapToken?: string },
  current: AdminIdentity | null,
) {
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!isAdminEmail(email)) throw new HttpError(403, "not_admin", copy.safety.admin.notAdmin);
  const admin = await ensureAdminUser(email);
  const db = await getDb();
  const existing = await db.select().from(adminCredentials).where(eq(adminCredentials.adminUserId, admin.id));

  const signedInAsSelf = current?.id === admin.id;
  if (!signedInAsSelf) {
    // Without a session only the first passkey can be registered, and only with the bootstrap token.
    const expected = process.env.ADMIN_BOOTSTRAP_TOKEN;
    const ok = !!expected && existing.length === 0 && typeof input.bootstrapToken === "string" && safeEqual(input.bootstrapToken, expected);
    if (!ok) throw new HttpError(403, "bad_token", copy.safety.admin.badToken);
  }

  const { rpID } = relyingParty(req);
  const options = await generateRegistrationOptions({
    rpName: copy.safety.admin.title,
    rpID,
    userName: admin.email,
    userID: new TextEncoder().encode(admin.id),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports ?? undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  return { options, setCookie: challengeCookie({ challenge: options.challenge, kind: "register", adminUserId: admin.id }) };
}

export async function verifyRegistration(req: Request, response: RegistrationResponseJSON) {
  const challenge = readChallenge(req, "register");
  const { rpID, origin } = relyingParty(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (err) {
    console.warn("[admin] passkey registration failed", String(err));
    throw new HttpError(400, "passkey_failed", copy.safety.admin.passkeyFailed);
  }
  if (!verification.verified) throw new HttpError(400, "passkey_failed", copy.safety.admin.passkeyFailed);

  const db = await getDb();
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, challenge.adminUserId!));
  if (!user || !isAdminEmail(user.email)) throw new HttpError(403, "not_admin", copy.safety.admin.notAdmin);
  const { credential } = verification.registrationInfo;
  await db.transaction(async (tx) => {
    await tx.insert(adminCredentials).values({
      id: credential.id,
      adminUserId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports ?? null,
    });
    await tx.insert(auditLog).values({ actor: user.email, action: "admin.passkey_register", target: credential.id });
  });
  const admin = { id: user.id, email: user.email, role: user.role };
  return { admin, setCookies: [await createSession(admin, "passkey-register"), clearChallenge()] };
}

export async function authenticationOptions(req: Request) {
  const { rpID } = relyingParty(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  return { options, setCookie: challengeCookie({ challenge: options.challenge, kind: "login" }) };
}

export async function verifyAuthentication(req: Request, response: AuthenticationResponseJSON) {
  const challenge = readChallenge(req, "login");
  const db = await getDb();
  const [cred] = await db.select().from(adminCredentials).where(eq(adminCredentials.id, String(response?.id ?? "")));
  if (!cred) throw new HttpError(400, "passkey_failed", copy.safety.admin.passkeyFailed);
  const { rpID, origin } = relyingParty(req);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.id,
        publicKey: new Uint8Array(Buffer.from(cred.publicKey, "base64url")),
        counter: cred.counter,
        transports: cred.transports ?? undefined,
      },
      requireUserVerification: false,
    });
  } catch (err) {
    console.warn("[admin] passkey login failed", String(err));
    throw new HttpError(400, "passkey_failed", copy.safety.admin.passkeyFailed);
  }
  if (!verification.verified) throw new HttpError(400, "passkey_failed", copy.safety.admin.passkeyFailed);

  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, cred.adminUserId));
  if (!user || user.role !== "admin" || !isAdminEmail(user.email)) throw new HttpError(403, "not_admin", copy.safety.admin.notAdmin);
  await db
    .update(adminCredentials)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: clockNow() })
    .where(eq(adminCredentials.id, cred.id));
  const admin = { id: user.id, email: user.email, role: user.role };
  return { admin, setCookies: [await createSession(admin, "passkey"), clearChallenge()] };
}

/** One-click development login as the first ADMIN_EMAILS entry. */
export async function devLogin(req: Request) {
  if (!devLoginAllowed(req.headers.get("host"))) throw new HttpError(404, "not_found", "Not found.");
  const admin = await ensureAdminUser(adminEmails()[0]);
  return { admin, setCookie: await createSession(admin, "dev-login") };
}
