// OWNER: G (F ships a no-op). Client-side, cookieless product analytics (PRD "Analytics").

export type AnalyticsEvent =
  | "page_view"
  | "tryon_started"
  | "checkout_opened"
  | "checkout_busy"
  | "quick_price_tapped"
  | "payment_submitted"
  | "moderation_rejected"
  | "takeover_completed"
  | "takeover_failed"
  | "share_clicked"
  | "overthrow_email_clicked";

export type AnalyticsProps = Record<string, string | number | boolean | null>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  // no-op until G wires POST /api/events
}
