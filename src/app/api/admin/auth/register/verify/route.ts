// OWNER: S. POST /api/admin/auth/register/verify — store the new passkey, start a session.
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistration } from "@/server/admin/auth";
import { withCookies } from "@/server/admin/route";
import { assertOrigin, json, readJson, withErrors } from "@/server/http";

export const POST = withErrors(async (req: Request) => {
  assertOrigin(req);
  const body = await readJson<RegistrationResponseJSON>(req);
  const { admin, setCookies } = await verifyRegistration(req, body);
  return withCookies(json({ ok: true, email: admin.email }), setCookies);
});
