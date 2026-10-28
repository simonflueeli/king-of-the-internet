// OWNER: F. Display formatting. Money always arrives in integer cents.

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/**
 * "€2.42" (or the locale's equivalent). `round: true` drops the cents ("€2", "€1,000,000").
 * `locale` defaults to the runtime's locale (the browser's, per PRD); pass one explicitly for
 * server-rendered text that must match on the client.
 */
export function formatMoney(cents: number, opts?: { round?: boolean; locale?: string }): string {
  const key = `${opts?.locale ?? ""}|${opts?.round ? 1 : 0}`;
  let f = moneyFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(opts?.locale, {
      style: "currency",
      currency: "EUR",
      ...(opts?.round ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    });
    moneyFormatters.set(key, f);
  }
  return f.format(cents / 100);
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** "41s", "12m 03s", "2h 14m 09s", "3d 4h 05m". */
export function formatDuration(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h ${p2(m)}m`;
  if (h) return `${h}h ${p2(m)}m ${p2(sec)}s`;
  if (m) return `${m}m ${p2(sec)}s`;
  return `${sec}s`;
}

/** "just now", "1 minute ago", "4 minutes ago", "2 hours ago", "3 days ago". */
export function formatAgo(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

/** Countdown "m:ss", rounded up to the next second: 161_000 → "2:41". */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${p2(s % 60)}`;
}

/** "a" / "an" for a title ("a Duke", "an Archduke"). */
export function article(word: string): "a" | "an" {
  return /^[AEIOU]/i.test(word) ? "an" : "a";
}

/** Truncate long names for button labels: over `max` characters → first max−1 + "…". */
export function truncateName(name: string, max = 16): string {
  const chars = Array.from(name);
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : name;
}
