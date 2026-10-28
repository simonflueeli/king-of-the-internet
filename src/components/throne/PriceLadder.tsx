// OWNER: U. "The price only goes up": lead text, curve chart and title ladder (FR-40…43).
import { memo, useMemo } from "react";
import type { ThroneId } from "@/lib/contracts";
import { copy, fill } from "@/lib/copy";
import { article } from "@/lib/format";
import { TITLE_THRESHOLDS, titleFor, type PricingConfig } from "@/lib/pricing";
import { stepPercent, type Money } from "./derive";
import { CHART_H, CHART_W, ladderModel } from "./ladder";
import s from "./throne.module.css";

const ui = copy.ui;

export const PriceLadder = memo(function PriceLadder({
  throne,
  minCents,
  money,
  pricing,
}: {
  throne: ThroneId;
  minCents: number;
  money: Money;
  pricing: PricingConfig;
}) {
  const model = useMemo(
    () =>
      ladderModel(
        minCents,
        {
          round: (c) => money(c, true),
          exact: (c) => money(c),
          takeover: (n) => fill(ui.chartTakeover, { n }),
          here: ui.chartHere,
          start: ui.chartStart,
        },
        pricing,
      ),
    [minCents, money, pricing],
  );

  const pct = stepPercent(pricing);
  let lead = fill(throne === "daily" ? ui.ladderLeadDaily : ui.ladderLeadEternal, {
    pct,
    base: money(pricing.baseCents),
    price: money(minCents),
  });
  lead +=
    model.m != null && model.priceAtM != null
      ? fill(ui.ladderReach2, { a: money(model.priceAtM, true), m: model.m, b: money(model.priceAtN, true), n: model.N })
      : fill(ui.ladderReach1, { b: money(model.priceAtN, true), n: model.N });
  lead += ui.ladderTail;

  const current = titleFor(minCents);
  const { here } = model;

  return (
    <section className={s.block} aria-labelledby="ladderHeading">
      <h2 id="ladderHeading">{ui.ladderHeading}</h2>
      <p className={s.lede} id="ladderText">
        {lead}
      </p>
      <div className={s.chartWrap}>
        <svg className={s.chart} viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-labelledby="ladderText">
          <defs>
            <linearGradient id="areaGold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#E2B04A" stopOpacity=".45" />
              <stop offset="1" stopColor="#E2B04A" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={model.areaPath} fill="url(#areaGold)" />
          <line x1={14} y1={model.axisY} x2={CHART_W - 14} y2={model.axisY} stroke="currentColor" strokeOpacity=".25" />
          <path d={model.linePath} fill="none" stroke="#C8921E" strokeWidth="3" strokeLinejoin="round" />
          {model.milestonePoint && <circle cx={model.milestonePoint.x} cy={model.milestonePoint.y} r="4" fill="#C8921E" />}
          <circle cx={model.finalPoint.x} cy={model.finalPoint.y} r="4" fill="#C8921E" />
          <line
            x1={here.cx}
            y1={here.cy - 8}
            x2={here.cx}
            y2={here.leaderTopY}
            stroke="#C8921E"
            strokeWidth="1.5"
            strokeDasharray="3 4"
          />
          <circle cx={here.cx} cy={here.cy} r="11" fill="#E2B04A" fillOpacity=".3" />
          <circle cx={here.cx} cy={here.cy} r="6" fill="#E2B04A" stroke="#8A5C10" strokeWidth="2" />
          {model.texts.map((t, i) => (
            <text key={i} className={t.cls} x={t.x} y={t.y} textAnchor={t.anchor}>
              {t.text}
            </text>
          ))}
        </svg>
      </div>
      <ol className={s.titles}>
        {TITLE_THRESHOLDS.map((t) => (
          <li key={t.title} className={t.title === current ? s.isCurrent : undefined} aria-current={t.title === current ? "true" : undefined}>
            <span className={s.tName}>{t.title}</span>
            <span className={s.tFrom}>{fill(ui.titleFrom, { price: money(Math.max(t.minCents, pricing.baseCents), true) })}</span>
          </li>
        ))}
      </ol>
      <p className={s.titlesNote}>{fill(ui.titlesNote, { article: article(current), title: current })}</p>
    </section>
  );
});
