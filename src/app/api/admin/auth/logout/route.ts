// OWNER: S. POST /api/admin/auth/logout — end the admin session.
import { ADMIN_COOKIE, adminFromToken, clearSessionCookie, endSession } from "@/server/admin/auth";
import { withCookies } from "@/server/admin/route";
import { assertOrigin, getCookie, json, withErrors } from "@/server/http";

export const POST = withErrors(async (req: Request) => {
  assertOrigin(req);
  const token = getCookie(req, ADMIN_COOKIE);
  const admin = await adminFromToken(token);
  await endSession(token, admin?.email ?? null);
  return withCookies(json({ ok: true }), [clearSessionCookie()]);
});
