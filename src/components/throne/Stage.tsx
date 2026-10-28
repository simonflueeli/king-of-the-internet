// OWNER: U. Header + hero stage (FR-01…FR-07, FR-20 preview).
import Link from "next/link";
import type { ThroneId, ThroneState } from "@/lib/contracts";
import { copy, fill } from "@/lib/copy";
import { formatDuration } from "@/lib/format";
import { titleFor } from "@/lib/pricing";
import type { Money } from "./derive";
import { ThroneSvg } from "./ThroneSvg";
import { Tnum } from "./Tnum";
import s from "./throne.module.css";

const THRONE_PATHS: Record<ThroneId, string> = { eternal: "/", daily: "/daily" };

export function Header({ throne }: { throne: ThroneId }) {
  return (
    <header className={s.header}>
      <span className={s.mark}>{copy.brand}</span>
      <nav className={s.switch} aria-label={copy.ui.switchAria}>
        {(["eternal", "daily"] as const).map((t) => (
          <Link key={t} href={THRONE_PATHS[t]} aria-current={t === throne ? "page" : undefined} prefetch>
            {copy.switchLabel[t]}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function Stage(props: {
  throne: ThroneId;
  state: ThroneState;
  now: number;
  tryName: string;
  mine: boolean;
  crownedSeq: number;
  money: Money;
  onReport: () => void;
}) {
  const { throne, state, now, tryName, mine, crownedSeq, money } = props;
  const king = state.king;
  const preview = !!tryName;
  const throneName = copy.throneName[throne];

  let hail: string;
  let name: string;
  let crestName: string | null;
  let plate: string | null = null;
  let proclamation: React.ReactNode = null;
  let reignLine: string;

  if (preview) {
    hail = copy.greetingTryOn;
    name = tryName;
    crestName = tryName;
    plate = fill(copy.titlePlate, { title: titleFor(state.minCents), throneName });
    reignLine = fill(copy.tryOnSeat, { price: money(state.minCents) });
  } else if (king) {
    hail = copy.greetingReigning;
    name = king.name;
    crestName = king.name;
    plate = fill(copy.titlePlate, { title: king.title, throneName });
    if (king.proclamationBlurred) {
      proclamation = <p className={s.proclamationHidden}>{copy.ui.proclamationHidden}</p>;
    } else if (king.proclamation) {
      proclamation = <p className={s.proclamation}>“{king.proclamation}”</p>;
    }
    const line = fill(copy.reignLine, { duration: formatDuration(now - Date.parse(king.crownedAt)) });
    reignLine = mine ? `${copy.thatsYou} ${line}` : line;
  } else {
    const reason = state.vacancy?.reason ?? "never";
    hail = reason === "removed" ? copy.vacantRemoved : reason === "reset" ? copy.vacantReset : copy.vacantNever;
    name = copy.vacantName;
    crestName = null;
    if (reason === "reset" && state.vacancy?.yesterdayRuler) {
      proclamation = <p className={s.proclamation}>{fill(copy.yesterdayRuler, { name: state.vacancy.yesterdayRuler })}</p>;
    }
    reignLine = fill(copy.ui.vacantReignLine, { price: money(state.minCents) });
  }

  // The crowned class stays on after a live takeover (toggling it would replay the animation); the key
  // below remounts the heading for each new takeover so the animation runs exactly once per takeover.
  const vacant = !preview && !king;
  const kingClass = [s.king, vacant ? s.vacant : "", !vacant && crownedSeq > 0 ? s.crowned : ""].filter(Boolean).join(" ");

  return (
    <div className={`${s.scene} ${preview ? s.isPreview : ""}`}>
      {preview && <span className={s.previewBadge}>{copy.previewBadge}</span>}
      <ThroneSvg className={s.throne} crestName={crestName} />
      <p className={s.hail}>{hail}</p>
      {/* key restarts the coronation animation on every live takeover (FR-05) */}
      <h1 key={`k${crownedSeq}`} className={kingClass}>
        {name}
      </h1>
      {plate && <p className={s.plate}>{plate}</p>}
      {proclamation}
      <p className={s.reign}>
        <Tnum>{reignLine}</Tnum>
      </p>
      {king && !preview && (
        <button type="button" className={s.reportLink} onClick={props.onReport} aria-haspopup="dialog">
          {copy.ui.reportLink}
        </button>
      )}
    </div>
  );
}
