// OWNER: F. Next 16 "proxy" (formerly middleware.ts; runs on the Node runtime).
// Ensures every visitor has a random first-party device id cookie `kti_device` (httpOnly, 1 year),
// used only for abuse limits. On the first request the id is also injected into the forwarded
// request's Cookie header so route handlers can read it immediately via deviceId(req).
import { NextResponse, type NextRequest } from "next/server";

const DEVICE_COOKIE = "kti_device"; // keep in sync with src/server/http.ts
const ONE_YEAR_S = 365 * 24 * 60 * 60;

function newDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function proxy(request: NextRequest) {
  if (request.cookies.has(DEVICE_COOKIE)) return NextResponse.next();

  const id = newDeviceId();
  const headers = new Headers(request.headers);
  const cookie = headers.get("cookie");
  headers.set("cookie", cookie ? `${cookie}; ${DEVICE_COOKIE}=${id}` : `${DEVICE_COOKIE}=${id}`);

  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(DEVICE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_S,
  });
  return response;
}

export const config = {
  // Everything except static assets and webhooks/cron (machine callers have no use for the cookie).
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/webhooks|api/cron|.*\\.(?:png|jpg|svg|ico|webp|woff2?)$).*)"],
};
