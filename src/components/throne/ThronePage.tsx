// OWNER: U. Client island for `/` and `/daily`: takes over from the server-rendered ThroneState and keeps
// it live, runs try-on, the locked notice, and opens the checkout sheet.
"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { track } from "@/lib/analytics";
import { getApi, mockScenario, MOCK_ALLOWED, type ReservationSource } from "@/lib/api-client";
import type { CreateReservationResponse, ThroneId, ThroneState } from "@/lib/contracts";
import { copy, fill } from "@/lib/copy";
import { formatClock } from "@/lib/format";
import { normalizeText } from "@/lib/normalize";
import { CheckoutDialog } from "@/components/checkout/CheckoutDialog";
import { useMoney } from "@/hooks/useFormat";
import { useMyReigns } from "@/hooks/useMyReigns";
import { FALLBACK_LIMITS, pricingOf, usePublicConfig } from "@/hooks/usePublicConfig";
import { useThrone, type ReservationResult } from "@/hooks/useThrone";
import { HallOfKings, HowItWorks, PageFooter } from "./HallOfKings";
import { PriceLadder } from "./PriceLadder";
import { ReportDialog } from "./ReportDialog";
import { Header, Stage } from "./Stage";
import { TakeSection } from "./TakeSection";
import s from "./throne.module.css";

// Dev-only panel to drive the in-browser mock; statically removed from production builds.
const MockPanel = MOCK_ALLOWED ? dynamic(() => import("@/components/dev/MockPanel"), { ssr: false }) : () => null;

const FLASH_MS = 8000;
const noopSubscribe = () => () => {};

interface OpenCheckout {
  reservation: CreateReservationResponse;
  source: ReservationSource;
  prefillName: string;
  kingWasMine: boolean;
}

function referrerType(): string {
  const params = new URLSearchParams(window.location.search);
  if (params.get("checkout") === "1") return "overthrow_email";
  if (!document.referrer) return "direct";
  try {
    const ref = new URL(document.referrer);
    if (ref.origin === window.location.origin && ref.pathname.startsWith("/r/")) return "share_page";
  } catch {
    // ignore
  }
  return "other";
}

export function ThronePage({ throne, initial }: { throne: ThroneId; initial: ThroneState }) {
  const money = useMoney();
  const config = usePublicConfig();
  const pricing = useMemo(() => pricingOf(config), [config]);
  const nameMax = config?.nameMax ?? FALLBACK_LIMITS.nameMax;
  const { isMine } = useMyReigns();
  const mock = useSyncExternalStore(noopSubscribe, () => mockScenario(), () => null);

  const [tryInput, setTryInput] = useState("");
  const tryName = Array.from(normalizeText(tryInput)).slice(0, nameMax).join("");
  const [checkout, setCheckout] = useState<OpenCheckout | null>(null);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const [flash, setFlash] = useState<{ text: string; until: number } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const takeRef = useRef<HTMLButtonElement | null>(null);
  /** Element that opened checkout (CTA or try-on input); focus returns there when the sheet closes. */
  const openerRef = useRef<HTMLElement | null>(null);
  const tryTracked = useRef(false);
  /** Lock end times of reservations this browser held, so our own lock never shows as "someone is paying". */
  const [ownLocks, setOwnLocks] = useState<number[]>([]);

  const resultHandlers = useRef(new Set<(r: ReservationResult) => void>());
  const onReservationResult = useCallback((r: ReservationResult) => resultHandlers.current.forEach((h) => h(r)), []);
  const subscribeResult = useCallback((fn: (r: ReservationResult) => void) => {
    resultHandlers.current.add(fn);
    return () => {
      resultHandlers.current.delete(fn);
    };
  }, []);

  const auth = checkout ? { id: checkout.reservation.reservationId, token: checkout.reservation.reservationToken } : null;
  const { state, now, liveCrown } = useThrone(throne, initial, { reservation: auth, onReservationResult });
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  });

  const mine = isMine(state.king?.id);
  const lockedUntil = state.reservation ? Date.parse(state.reservation.lockedUntil) : 0;
  const ownLock = ownLocks.some((t) => Math.abs(t - lockedUntil) < 1500);
  const lockedByOther = !checkout && !ownLock && lockedUntil > now;
  const notice = lockedByOther
    ? fill(copy.lockedNotice, { clock: formatClock(lockedUntil - now) })
    : flash && flash.until > now
      ? flash.text
      : null;

  const addOwnLock = useCallback((ms: number) => setOwnLocks((l) => (l.includes(ms) ? l : [...l.slice(-5), ms])), []);
  const showFlash = useCallback((text: string) => setFlash({ text, until: nowRef.current + FLASH_MS }), []);

  const openCheckout = useCallback(
    async (source: ReservationSource, prefillName: string) => {
      if (openingRef.current) return;
      openingRef.current = true;
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : takeRef.current;
      setOpening(true);
      setFlash(null);
      try {
        const api = await getApi();
        const r = await api.createReservation(throne, source);
        if (r.ok) {
          addOwnLock(Date.parse(r.data.expiresAt));
          setCheckout({ reservation: r.data, source, prefillName, kingWasMine: isMine(state.king?.id) });
          track("checkout_opened", { throne, source, minPrice: r.data.minCents });
        } else if (r.status === 409) {
          track("checkout_busy", { throne });
          showFlash(copy.errBusy);
        } else if (r.status === 429) {
          showFlash(copy.errRateLimited);
        } else if (r.status === 403) {
          showFlash(copy.ui.errBanned);
        } else {
          showFlash(r.status === 0 ? copy.ui.errNetwork : copy.errGeneric);
        }
      } finally {
        openingRef.current = false;
        setOpening(false);
      }
    },
    [throne, isMine, state.king?.id, showFlash, addOwnLock],
  );

  const closeCheckout = useCallback(
    (flashText: string | null) => {
      setCheckout(null);
      if (flashText) showFlash(flashText);
      else setFlash(null);
    },
    [showFlash],
  );

  // Analytics page view, and the reclaim link (`?checkout=1&name=…`) opening checkout with the old name.
  useEffect(() => {
    track("page_view", { throne, referrer: referrerType() });
    const url = new URL(window.location.href);
    if (url.searchParams.get("checkout") !== "1") return;
    const name = url.searchParams.get("name") ?? "";
    url.searchParams.delete("checkout");
    url.searchParams.delete("name");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    const t = setTimeout(() => void openCheckout("reclaim", name), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearTryOn = useCallback(() => setTryInput(""), []);
  const onTryInput = (v: string) => {
    setTryInput(v);
    if (v.trim() && !tryTracked.current) {
      tryTracked.current = true;
      track("tryon_started", { throne });
    }
  };

  const announce = liveCrown.seq > 0 && state.king
    ? fill(copy.ui.liveCrowned, { title: state.king.title, name: state.king.name, throneLabel: copy.throneLabel[throne] })
    : "";

  return (
    <>
      <div className={s.stage}>
        <div className={s.beam} aria-hidden="true" />
        <div className={s.inner}>
          <Header throne={throne} />
          <Stage
            throne={throne}
            state={state}
            now={now}
            tryName={tryName}
            mine={mine}
            crownedSeq={liveCrown.seq}
            money={money}
            onReport={() => setReportOpen(true)}
          />
        </div>
      </div>
      <div className={s.hem} aria-hidden="true" />
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>

      <main className={s.inner}>
        <TakeSection
          throne={throne}
          state={state}
          now={now}
          mine={mine}
          tryName={tryName}
          tryInput={tryInput}
          onTryInput={onTryInput}
          onTake={(source) => void openCheckout(source, tryName)}
          busy={lockedByOther || opening || !!checkout}
          notice={notice}
          money={money}
          pricing={pricing}
          nameMax={nameMax}
          buttonRef={takeRef}
        />
        <PriceLadder throne={throne} minCents={state.minCents} money={money} pricing={pricing} />
        <HallOfKings throne={throne} state={state} now={now} money={money} pricing={pricing} />
        <HowItWorks />
        <PageFooter />
      </main>

      {checkout && (
        <CheckoutDialog
          key={checkout.reservation.reservationId}
          throne={throne}
          reservation={checkout.reservation}
          prefillName={checkout.prefillName}
          config={config}
          now={now}
          king={state.king}
          kingWasMine={checkout.kingWasMine}
          money={money}
          subscribeResult={subscribeResult}
          returnFocusTo={openerRef}
          onLock={addOwnLock}
          onCrowned={clearTryOn}
          onClose={closeCheckout}
        />
      )}
      {reportOpen && state.king && (
        <ReportDialog reignId={state.king.id} name={state.king.name} onClose={() => setReportOpen(false)} />
      )}
      {mock && <MockPanel throne={throne} />}
    </>
  );
}
