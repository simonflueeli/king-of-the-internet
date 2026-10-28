// OWNER: S. POST /api/admin/auth/register/options body { email, bootstrapToken? } — WebAuthn
// registration options. An admin's first passkey needs ADMIN_BOOTSTRAP_TOKEN; more need a session.
import { ADMIN_COOKIE, adminFromToken, registrationOptions } from "@/server/admin/auth";
import { withCookies } from "@/server/admin/route";
import { assertOrigin, getCookie, json, readJson, withErrors } from "@/server/http";

export const POST = withErrors(async (req: Request) => {
  assertOrigin(req);
  const body = await readJson<{ email?: string; bootstrapToken?: string }>(req);
  const current = await adminFromToken(getCookie(req, ADMIN_COOKIE));
  const { options, setCookie } = await registrationOptions(
    req,
    { email: String(body?.email ?? ""), bootstrapToken: body?.bootstrapToken },
    current,
  );
  return withCookies(json(options), [setCookie]);
});
