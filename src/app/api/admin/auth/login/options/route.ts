// OWNER: S. POST /api/admin/auth/login/options — WebAuthn authentication options (discoverable passkeys).
import { authenticationOptions } from "@/server/admin/auth";
import { withCookies } from "@/server/admin/route";
import { assertOrigin, json, withErrors } from "@/server/http";

export const POST = withErrors(async (req: Request) => {
  assertOrigin(req);
  const { options, setCookie } = await authenticationOptions(req);
  return withCookies(json(options), [setCookie]);
});
