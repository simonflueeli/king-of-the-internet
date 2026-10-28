// OWNER: U. Call to action (FR-10…14), try-on (FR-20/21) and live signal chips (FR-30…32).
import type { RefObject } from "react";
import type { ThroneId, ThroneState } from "@/lib/contracts";
import { copy, fill } from "@/lib/copy";
import { formatAgo, formatDuration, truncateName } from "@/lib/format";
import type { PricingConfig } from "@/lib/pricing";
import { ctaLabel, metaLine, pitchLine, type Money } from "./derive";
import { CrownIcon } from "./ThroneSvg";
import s from "./throne.module.css";

export function TakeSection(props: {
  throne: ThroneId;
  state: ThroneState;
  now: number;
  mine: boolean;
  tryName: string;
  tryInput: string;
  onTryInput: (v: string) => void;
  onTake: (source: "button" | "tryon") => void;
  busy: boolean;
  notice: string | null;
  money: Money;
  pricing: PricingConfig;
  nameMax: number;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const { throne, state, now, mine, tryName, money, busy, notice, tryInput, onTryInput, onTake, nameMax, pricing, buttonRef } = props;
  const king = state.king;

  const label = ctaLabel({ mine, tryName, kingName: king?.name ?? null, minCents: state.minCents, money });
  const pitch = pitchLine({ throne, king, mine, minCents: state.minCents });
  const meta = metaLine(state, now, money, formatDuration, pricing);

  const lastAt = state.lastTakeoverAt ? Date.parse(state.lastTakeoverAt) : null;
  const longest = state.stats.longest;
  const longestMs = longest ? (longest.endedAt ? longest.lengthMs : now - Date.parse(longest.startedAt)) : 0;

  return (
    <section className={s.take}>
      <button
        ref={buttonRef}
        type="button"
        className={s.takeBtn}
        disabled={busy}
        onClick={() => onTake(tryName ? "tryon" : "button")}
      >
        <CrownIcon />
        <span>{label}</span>
      </button>
      <p className={s.pitch}>{pitch}</p>
      <p className={s.meta}>{meta}</p>
      <p className={s.meta}>{copy.extraPayHint}</p>
      {notice && (
        <p className={s.notice} role="status">
          {notice}
        </p>
      )}
      <div className={s.tryon}>
        <label htmlFor="tryInput">{copy.tryOnLabel}</label>
        <input
          id="tryInput"
          value={tryInput}
          maxLength={nameMax}
          placeholder={copy.ui.tryOnPlaceholder}
          autoComplete="nickname"
          onChange={(e) => onTryInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && tryName && !busy) {
              e.preventDefault();
              onTake("tryon");
            }
          }}
        />
      </div>
      <ul className={s.pulse} aria-label={copy.ui.liveSignals}>
        {state.watching >= 2 && (
          <li>
            <span className={s.liveDot} aria-hidden="true" />
            <span>{fill(copy.ui.watching, { n: state.watching })}</span>
          </li>
        )}
        {lastAt != null && (
          <li>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M8 4.5V8l2.5 1.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span>{fill(copy.ui.lastTakeover, { ago: formatAgo(now - lastAt) })}</span>
          </li>
        )}
        {longest && longestMs > 60_000 && (
          <li>
            <CrownIcon />
            <span>{fill(copy.ui.recordReign, { duration: formatDuration(longestMs), name: truncateName(longest.name, 16) })}</span>
          </li>
        )}
      </ul>
    </section>
  );
}
