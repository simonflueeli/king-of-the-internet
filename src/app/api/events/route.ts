// OWNER: G. Analytics ingest for track() (src/lib/analytics.ts). Cookieless: stores only the event
// name and its flat properties; no IP, device id or user agent.
import { cleanAnalyticsProps, isAnalyticsEvent } from "@/lib/analytics";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { analyticsEvents } from "@/server/db/schema";
import { apiError, checkOrigin } from "@/server/http";

const MAX_BODY_BYTES = 4_096;

export async function POST(req: Request): Promise<Response> {
  const forbidden = checkOrigin(req);
  if (forbidden) return forbidden;

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return apiError(413, "too_large", "Event too large.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return apiError(400, "bad_request", "The request body must be JSON.");
  }
  const { name, props } = (body ?? {}) as { name?: unknown; props?: unknown };
  if (!isAnalyticsEvent(name)) return apiError(400, "unknown_event", "Unknown event.");
  const clean = cleanAnalyticsProps(props);
  if (!clean) return apiError(400, "validation", "Event properties must be a flat object of primitives.");

  const db = await getDb();
  await db.insert(analyticsEvents).values({ name, props: clean, createdAt: now() });
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
