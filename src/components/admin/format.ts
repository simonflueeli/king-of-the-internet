// OWNER: S. Deterministic formatting for admin pages (UTC, en-GB money: no hydration drift).
import { formatDuration, formatMoney } from "@/lib/format";

export const money = (cents: number | null | undefined) => (cents == null ? "—" : formatMoney(cents, { locale: "en-GB" }));

export function utc(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const iso = (typeof d === "string" ? new Date(d) : d).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

export const duration = (ms: number) => formatDuration(ms);

export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : "—");
