// OWNER: U. Hall of kings: summary, record cards and recent rulers (FR-50…52), plus "How it works" and footer.
import Link from "next/link";
import type { ReignDTO, ThroneId, ThroneState } from "@/lib/contracts";
import { copy, fill } from "@/lib/copy";
import { formatDuration } from "@/lib/format";
import type { PricingConfig } from "@/lib/pricing";
import { Crest } from "./Crest";
import type { Money } from "./derive";
import s from "./throne.module.css";

const ui = copy.ui;
const REMOVED: ReadonlySet<string> = new Set(["removed", "refunded", "disputed"]);

function lengthOf(r: ReignDTO, now: number): number {
  return r.endedAt ? r.lengthMs : Math.max(0, now - Date.parse(r.startedAt));
}

function RecordCard({ label, reign, value, idPrefix }: { label: string; reign: ReignDTO; value: string; idPrefix: string }) {
  return (
    <div className={s.record}>
      <Crest name={reign.name} idPrefix={idPrefix} className={s.crestMd} />
      <div>
        <p className={s.recordLabel}>{label}</p>
        <p className={s.recordWho}>{fill(copy.hallName, { title: reign.title, name: reign.name })}</p>
        <p className={s.recordWhat}>{value}</p>
      </div>
    </div>
  );
}

export function HallOfKings({ throne, state, now, money, pricing }: { throne: ThroneId; state: ThroneState; now: number; money: Money; pricing: PricingConfig }) {
  const daily = throne === "daily";
  const { stats, recent } = state;
  const count = stats.reignCount;

  const summary = count
    ? fill(daily ? ui.hallSummaryDaily : ui.hallSummary, {
        count,
        kingWord: count === 1 ? ui.kingHas : ui.kingsHave,
        total: money(stats.totalPaidCents),
      })
    : fill(daily ? ui.hallEmptyDaily : ui.hallEmpty, { base: money(pricing.baseCents) });

  return (
    <section className={s.block} aria-labelledby="hallHeading">
      <h2 id="hallHeading">{ui.hallHeading}</h2>
      <p className={s.lede}>{summary}</p>
      {(stats.longest || stats.highest) && (
        <div className={s.records}>
          {stats.longest && (
            <RecordCard
              label={daily ? ui.recordLongestDaily : ui.recordLongest}
              reign={stats.longest}
              value={formatDuration(lengthOf(stats.longest, now))}
              idPrefix="rec-long"
            />
          )}
          {stats.highest && (
            <RecordCard
              label={daily ? ui.recordHighestDaily : ui.recordHighest}
              reign={stats.highest}
              value={money(stats.highest.paidCents)}
              idPrefix="rec-high"
            />
          )}
        </div>
      )}
      {recent.length > 0 && (
        <>
          <h3>{ui.recentHeading}</h3>
          <ol className={s.rulers}>
            {recent.map((r, i) => {
              const d = formatDuration(lengthOf(r, now));
              const time = !r.endedAt
                ? fill(ui.rowReigning, { duration: d })
                : REMOVED.has(r.endReason ?? "")
                  ? fill(ui.rowRemoved, { duration: d })
                  : fill(ui.rowRuled, { duration: d });
              return (
                <li key={r.id}>
                  <Crest name={r.name} idPrefix={`row${i}`} className={s.crestSm} />
                  <span className={s.rName}>
                    <span className={s.rTitle}>{r.title} </span>
                    {r.name}
                  </span>
                  <span className={s.rPaid}>{money(r.paidCents)}</span>
                  <span className={s.rTime}>{time}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

export function HowItWorks() {
  return (
    <section className={`${s.block} ${s.rules}`} aria-labelledby="howHeading">
      <h2 id="howHeading">{ui.howHeading}</h2>
      {ui.how.map((p) => (
        <p key={p}>{p}</p>
      ))}
    </section>
  );
}

const LEGAL = [
  ["terms", "/legal/terms"],
  ["privacy", "/legal/privacy"],
  ["imprint", "/legal/imprint"],
  ["contact", "/legal/contact"],
  ["refunds", "/legal/refunds"],
] as const;

export function PageFooter() {
  return (
    <footer className={s.foot}>
      <nav aria-label={ui.footerNav}>
        <ul>
          {LEGAL.map(([key, href]) => (
            <li key={key}>
              <Link href={href} prefetch={false}>
                {ui.footerLinks[key]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p>{ui.footerNote}</p>
    </footer>
  );
}
