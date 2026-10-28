// OWNER: S. Wrapper for every /api/admin/** handler: ApiError responses, CSRF origin check on
// mutating methods, and the admin role check.
import { assertOrigin, withErrors } from "../http";
import { requireAdmin, type AdminIdentity } from "./auth";

export function adminRoute<A extends unknown[]>(
  handler: (req: Request, admin: AdminIdentity, ...rest: A) => Promise<Response>,
): (req: Request, ...rest: A) => Promise<Response> {
  return withErrors(async (req: Request, ...rest: A) => {
    if (req.method !== "GET" && req.method !== "HEAD") assertOrigin(req);
    const admin = await requireAdmin(req);
    return handler(req, admin, ...rest);
  });
}

/** Response with one or more Set-Cookie headers. */
export function withCookies(res: Response, cookies: string[]): Response {
  for (const c of cookies) res.headers.append("set-cookie", c);
  return res;
}
