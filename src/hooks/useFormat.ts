// OWNER: U. Locale-aware formatting that hydrates cleanly: the server and the hydration pass use a fixed
// locale, then the client re-renders with the browser's locale (PRD "Localization").
"use client";
import { useCallback, useSyncExternalStore } from "react";
import { formatMoney } from "@/lib/format";

export const SSR_LOCALE = "en-IE";

const noopSubscribe = () => () => {};

export function useLocale(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => (typeof navigator !== "undefined" && navigator.language) || SSR_LOCALE,
    () => SSR_LOCALE,
  );
}

/** money(cents) → "€2.42"; money(cents, true) → "€2". */
export function useMoney(): (cents: number, round?: boolean) => string {
  const locale = useLocale();
  return useCallback((cents: number, round?: boolean) => formatMoney(cents, { round, locale }), [locale]);
}

const reducedQuery = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(reducedQuery);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(reducedQuery).matches,
    () => false,
  );
}
