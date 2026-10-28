// OWNER: S. POST /api/admin/auth/login/verify — verify the passkey assertion, start a session.
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAuthentication } from "@/server/admin/auth";
import { withCookies } from "@/server/admin/route";
import { assertOrigin, json, readJson, withErrors } from "@/server/http";

export const POST = withErrors(async (req: Request) => {
  assertOrigin(req);
  const body = await readJson<AuthenticationResponseJSON>(req);
  const { admin, setCookies } = await verifyAuthentication(req, body);
  return withCookies(json({ ok: true, email: admin.email }), setCookies);
});
