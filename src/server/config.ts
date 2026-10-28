// OWNER: F. Typed runtime configuration: `config` table merged over CONFIG_DEFAULTS, cached 30 s.
import { sql } from "drizzle-orm";
import type { PricingConfig } from "@/lib/pricing";
import { CONFIG_DEFAULTS, type AppConfig } from "./config-defaults";
import { getDb } from "./db/client";
import { config as configTable } from "./db/schema";

export { CONFIG_DEFAULTS, type AppConfig } from "./config-defaults";

export const CONFIG_CACHE_MS = 30_000;

type Cache = { value: AppConfig; loadedAt: number } | null;
const g = globalThis as unknown as { __ktiConfigCache?: { current: Cache } };
const cache = (g.__ktiConfigCache ??= { current: null });

function isValidValue<K extends keyof AppConfig>(key: K, value: unknown): value is AppConfig[K] {
  return typeof value === typeof CONFIG_DEFAULTS[key];
}

export async function getConfig(): Promise<AppConfig> {
  // Real time on purpose: the cache must not be affected by tests moving the fake clock.
  const t = Date.now();
  if (cache.current && t - cache.current.loadedAt < CONFIG_CACHE_MS) return cache.current.value;
  const db = await getDb();
  const rows = await db.select().from(configTable);
  const value: AppConfig = { ...CONFIG_DEFAULTS };
  for (const row of rows) {
    const key = row.key as keyof AppConfig;
    if (key in CONFIG_DEFAULTS && isValidValue(key, row.value)) {
      (value as unknown as Record<string, unknown>)[key] = row.value;
    }
  }
  cache.current = { value, loadedAt: t };
  return value;
}

export function invalidateConfigCache(): void {
  cache.current = null;
}

/** Upsert config values (admin AD-07). Audit logging is the caller's job. */
export async function updateConfig(patch: Partial<AppConfig>, actor: string): Promise<AppConfig> {
  const entries = Object.entries(patch).filter(([k]) => k in CONFIG_DEFAULTS);
  for (const [k, v] of entries) {
    if (!isValidValue(k as keyof AppConfig, v)) throw new Error(`Invalid config value for ${k}`);
  }
  if (entries.length) {
    const db = await getDb();
    await db
      .insert(configTable)
      .values(entries.map(([key, value]) => ({ key, value, updatedBy: actor, updatedAt: new Date() })))
      .onConflictDoUpdate({
        target: configTable.key,
        set: { value: sql`excluded.value`, updatedBy: sql`excluded.updated_by`, updatedAt: sql`excluded.updated_at` },
      });
  }
  invalidateConfigCache();
  return getConfig();
}

export function pricingConfig(cfg: AppConfig): PricingConfig {
  return { baseCents: cfg.baseCents, stepBps: cfg.stepBps, decayBps: cfg.decayBps, maxCents: cfg.maxCents };
}
