// OWNER: F. Helpers for route handlers: JSON responses, ApiError bodies, client IP, device id,
// CSRF Origin check.
import type { ApiError } from "@/lib/contracts";

export const DEVICE_COOKIE = "kti_device";

export function json<T>(data: T, init?: number | ResponseInit): Response {
  const base: ResponseInit = typeof init === "number" ? { status: init } : (init ?? {});
  const headers = new Headers(base.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...base, headers });
}

export function apiError(
  status: number,
  error: string,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  const body: ApiError = { ...extra, error, message };
  return json(body, status);
}

/** Throw from anywhere in a handler; withErrors() turns it into an ApiError response. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: string,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
  toResponse(): Response {
    return apiError(this.status, this.error, this.message, this.extra);
  }
}

/**
 * Wraps a route handler: HttpError → its ApiError response, anything else → 500 (logged).
 *   export const POST = withErrors(async (req, ctx) => { ... });
 */
export function withErrors<A extends unknown[]>(
  handler: (req: Request, ...rest: A) => Promise<Response>,
): (req: Request, ...rest: A) => Promise<Response> {
  return async (req, ...rest) => {
    try {
      return await handler(req, ...rest);
    } catch (err) {
      if (err instanceof HttpError) return err.toResponse();
      console.error("[api] unhandled error", { method: req.method, url: req.url, err });
      return apiError(500, "internal", "Something went wrong. Try again.");
    }
  };
}

/** Parse a JSON body or throw 400. */
export async function readJson<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "bad_request", "The request body must be JSON.");
  }
}

/** Best-effort client IP: first X-Forwarded-For hop, then X-Real-IP, else "0.0.0.0". */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "0.0.0.0";
}

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      const v = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return null;
}

/** Device id from the `kti_device` cookie (set by src/proxy.ts on every page/API request). */
export function deviceId(req: Request): string | null {
  const v = getCookie(req, DEVICE_COOKIE);
  return v && /^[A-Za-z0-9_-]{16,64}$/.test(v) ? v : null;
}

function appOrigin(): string | null {
  try {
    return new URL(process.env.APP_URL || "http://localhost:3000").origin;
  } catch {
    return null;
  }
}

/**
 * CSRF check for mutating routes. Allowed: no Origin header (non-browser clients — browsers always
 * send Origin on POST/DELETE), Origin equal to APP_URL, or Origin equal to the request's own host.
 * Returns a 403 response to send, or null when the request may proceed.
 */
export function checkOrigin(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  if (origin === appOrigin()) return null;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    try {
      if (new URL(origin).host === host) return null;
    } catch {
      // fall through
    }
  }
  return apiError(403, "forbidden_origin", "This request came from another site.");
}

/** Throwing variant of checkOrigin() for use inside withErrors(). */
export function assertOrigin(req: Request): void {
  if (checkOrigin(req)) throw new HttpError(403, "forbidden_origin", "This request came from another site.");
}
