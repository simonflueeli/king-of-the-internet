// OWNER: G. Client-side, cookieless product analytics (PRD "Analytics"). Events go to POST
// /api/events with navigator.sendBeacon (fetch keepalive as fallback) and land in analytics_events.
// No cookies, no identifiers: only the event name and its flat properties. Revenue numbers come
// from the database, never from here.
//
// Property names per event (snake_case, values are strings, numbers, booleans or null):
//   page_view               throne, referrer ("direct" | "share" | "email" | "other")
//   tryon_started           throne
//   checkout_opened         throne, source ("button" | "tryon" | "reclaim"), min_cents
//   checkout_busy           throne
//   quick_price_tapped      label ("minimum" | "title" | "x2" | "x5")
//   payment_submitted       throne, amount_cents, overpay_pct
//   moderation_rejected     field, category
//   takeover_completed      throne, amount_cents, overpay_pct, title, was_previous_king
//   takeover_failed         throne, reason
//   share_clicked           method ("native" | "copy")
//   overthrow_email_clicked throne, minutes_since_overthrow   (recorded server-side by /api/reclaim)

export const ANALYTICS_EVENTS = [
  "page_view",
  "tryon_started",
  "checkout_opened",
  "checkout_busy",
  "quick_price_tapped",
  "payment_submitted",
  "moderation_rejected",
  "takeover_completed",
  "takeover_failed",
  "share_clicked",
  "overthrow_email_clicked",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export type AnalyticsProps = Record<string, string | number | boolean | null>;

export const ANALYTICS_ENDPOINT = "/api/events";
export const ANALYTICS_MAX_PROPS = 16;
export const ANALYTICS_MAX_STRING = 200;
export const ANALYTICS_PROP_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export function isAnalyticsEvent(v: unknown): v is AnalyticsEvent {
  return typeof v === "string" && (ANALYTICS_EVENTS as readonly string[]).includes(v);
}

/**
 * Validate and normalize event properties. Returns null when the shape is wrong (not a flat object,
 * too many keys, bad key names or nested values). Long strings are truncated.
 */
export function cleanAnalyticsProps(v: unknown): AnalyticsProps | null {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > ANALYTICS_MAX_PROPS) return null;
  const out: AnalyticsProps = {};
  for (const [k, val] of entries) {
    if (!ANALYTICS_PROP_KEY.test(k)) return null;
    if (val === null || typeof val === "boolean") out[k] = val;
    else if (typeof val === "number") {
      if (!Number.isFinite(val)) return null;
      out[k] = val;
    } else if (typeof val === "string") out[k] = val.slice(0, ANALYTICS_MAX_STRING);
    else return null;
  }
  return out;
}

/** Fire-and-forget. Never throws, does nothing on the server. */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({ name: event, props: props ?? {} });
    const blob = new Blob([body], { type: "application/json" });
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ANALYTICS_ENDPOINT, blob)) return;
    void fetch(ANALYTICS_ENDPOINT, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  } catch {
    // analytics must never break the page
  }
}
