// OWNER: G. Formatting for share pages and OG images.
import { formatMoney } from "@/lib/format";

/** Server-rendered share text uses one fixed locale so pages and images match. */
export const SHARE_LOCALE = "en-IE";

export const shareMoney = (cents: number) => formatMoney(cents, { locale: SHARE_LOCALE });

/** Reign length for "Ruled for …" (FR-70): "41s", "12m", "2h 03m", "3d 4h 05m". */
export function formatReignLength(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const mm = String(m).padStart(2, "0");
  if (d) return `${d}d ${h}h ${mm}m`;
  if (h) return `${h}h ${mm}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}
