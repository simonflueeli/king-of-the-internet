// OWNER: S. POST /api/admin/auth/dev-login — one-click login (ADMIN_DEV_LOGIN=1, localhost, not production).
import { devLogin } from "@/server/admin/auth";
import { withCookies } from "@/server/admin/route";
import { assertOrigin, json, withErrors } from "@/server/http";

export const POST = withErrors(async (req: Request) => {
  assertOrigin(req);
  const { admin, setCookie } = await devLogin(req);
  return withCookies(json({ ok: true, email: admin.email }), [setCookie]);
});
