"use client";
// OWNER: S. AD-07: edit configuration values with a preview of the effect on the next minimum price.
import { useMemo, useState } from "react";
import type { ThroneId } from "@/lib/contracts";
import { formatMoney } from "@/lib/format";
import { minPriceCents, nextMinCents, type PricingConfig } from "@/lib/pricing";
import { useAdminAction } from "./client";
import s from "./admin.module.css";

const money = (cents: number) => formatMoney(cents, { locale: "en-GB" });

export interface ThronePricingSnapshot {
  throne: ThroneId;
  lastPaidCents: number | null;
  crownedAt: string | null;
  serverNow: string;
}

const HINTS: Record<string, string> = {
  baseCents: "cents",
  stepBps: "basis points (1000 = 10%)",
  decayBps: "basis points per idle day",
  maxCents: "cents",
  nameMax: "characters",
  proclamationMax: "characters",
  rateLimitCount: "reservations per window",
  reportBlurThreshold: "distinct IPs",
  moderationRetentionDays: "days",
};

export function ConfigEditor(props: { config: Record<string, number>; keys: string[]; thrones: ThronePricingSnapshot[] }) {
  const { run, busy, error } = useAdminAction();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.keys.map((k) => [k, String(props.config[k])])),
  );
  const [saved, setSaved] = useState(false);

  const parsed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]));
  const invalid = Object.entries(parsed).filter(([, v]) => !Number.isSafeInteger(v) || v < 0).map(([k]) => k);
  const changed = props.keys.filter((k) => parsed[k] !== props.config[k]);

  const pricing = (src: Record<string, number>): PricingConfig => ({
    baseCents: src.baseCents,
    stepBps: src.stepBps,
    decayBps: src.decayBps,
    maxCents: src.maxCents,
  });

  const preview = useMemo(
    () =>
      props.thrones.map((t) => {
        const now = new Date(t.serverNow);
        const last = t.lastPaidCents != null && t.crownedAt ? { paidCents: t.lastPaidCents, crownedAt: new Date(t.crownedAt) } : null;
        const cur = pricing(props.config);
        const next = invalid.length ? null : pricing(parsed);
        const curMin = minPriceCents(t.throne, last, now, cur);
        const newMin = next ? minPriceCents(t.throne, last, now, next) : null;
        return {
          throne: t.throne,
          curMin,
          newMin,
          curNext: nextMinCents(curMin, cur),
          newNext: next && newMin != null ? nextMinCents(newMin, next) : null,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [values, props.config, props.thrones],
  );

  return (
    <form
      className={s.stack}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        if (invalid.length || !changed.length) return;
        const patch = Object.fromEntries(changed.map((k) => [k, parsed[k]]));
        if (await run("/api/admin/config", "PATCH", patch)) setSaved(true);
      }}
    >
      <div className={s.card}>
        <h2 className={s.h2}>Preview</h2>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Throne</th>
                <th className={s.num}>Minimum now</th>
                <th className={s.num}>With new values</th>
                <th className={s.num}>Next minimum now</th>
                <th className={s.num}>With new values</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((p) => (
                <tr key={p.throne}>
                  <td>{p.throne}</td>
                  <td className={s.num}>{money(p.curMin)}</td>
                  <td className={s.num}>{p.newMin == null ? "—" : money(p.newMin)}</td>
                  <td className={s.num}>{money(p.curNext)}</td>
                  <td className={s.num}>{p.newNext == null ? "—" : money(p.newNext)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={`${s.muted} ${s.small}`}>
          “Next minimum” is what the following challenger pays if the next buyer pays exactly the minimum. Changes apply
          within 30 seconds.
        </p>
      </div>
      <div className={s.card}>
        <div className={s.grid2} style={{ gap: 10 }}>
          {props.keys.map((k) => (
            <label key={k} className={s.label}>
              <span>
                {k} {HINTS[k] ? <span className={s.small}>({HINTS[k]})</span> : null}
                {changed.includes(k) ? <span className={s.badgeGold}> changed</span> : null}
              </span>
              <input
                className={s.input}
                inputMode="numeric"
                value={values[k]}
                aria-invalid={invalid.includes(k)}
                onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className={s.row} style={{ marginTop: 12 }}>
          <button type="submit" className={s.primary} disabled={busy || !!invalid.length || !changed.length}>
            Save {changed.length ? `${changed.length} change${changed.length > 1 ? "s" : ""}` : ""}
          </button>
          {invalid.length > 0 && <span className={s.error}>Whole numbers only: {invalid.join(", ")}</span>}
          {error && (
            <span role="alert" className={s.error}>
              {error}
            </span>
          )}
          {saved && !changed.length && <span className={s.ok}>Saved.</span>}
        </div>
      </div>
    </form>
  );
}
