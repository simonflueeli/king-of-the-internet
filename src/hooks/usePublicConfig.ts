// OWNER: U. GET /api/config/public once per page (pricing parameters, limits, payment mode).
"use client";
import { useEffect, useState } from "react";
import { getApi } from "@/lib/api-client";
import type { PublicConfig } from "@/lib/contracts";
import { DEFAULT_PRICING, type PricingConfig } from "@/lib/pricing";

export const FALLBACK_LIMITS = { nameMax: 24, proclamationMax: 140, heartbeatMs: 20_000 };

export function usePublicConfig(): PublicConfig | null {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const load = (attempt: number) => {
      void getApi()
        .then((api) => api.getPublicConfig())
        .then((r) => {
          if (cancelled) return;
          if (r.ok) setConfig(r.data);
          else if (attempt < 5) retry = setTimeout(() => load(attempt + 1), 2000 * (attempt + 1));
        });
    };
    load(0);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, []);
  return config;
}

export function pricingOf(config: PublicConfig | null): PricingConfig {
  return config
    ? { baseCents: config.baseCents, stepBps: config.stepBps, decayBps: config.decayBps, maxCents: config.maxCents }
    : DEFAULT_PRICING;
}
