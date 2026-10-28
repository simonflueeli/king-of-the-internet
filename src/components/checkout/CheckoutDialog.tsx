// OWNER: U. Checkout sheet (PRD "Checkout form" and "Flow"): holds the reservation (heartbeat, lock
// countdown), collects amount/name/proclamation/email/consents, confirms, authorizes (Stripe Payment Element
// or the fake-mode test card), waits for the reservation result, then shows the coronation or the failure.
"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { track } from "@/lib/analytics";
import { getApi, type ApiResult, type ReservationAuth } from "@/lib/api-client";
import type { CreateReservationResponse, FailReason, PublicConfig, ReservationState, ReservationStatus, ThroneId, ThroneState } from "@/lib/contracts";
import { copy, fill } from "@/lib/copy";
import { crestHash } from "@/lib/crest";
import { formatClock } from "@/lib/format";
import { normalizeText, textLength } from "@/lib/normalize";
import { nextMinCents, titleFor } from "@/lib/pricing";
import { amountHelp, centsToInput, chipOptions, overpayPercent, parseAmountToCents, type Money } from "@/components/throne/derive";
import { Crest } from "@/components/throne/Crest";
import { useModalDialog } from "@/components/throne/useModalDialog";
import { addMyReign } from "@/hooks/useMyReigns";
import { FALLBACK_LIMITS, pricingOf } from "@/hooks/usePublicConfig";
import type { ReservationResult } from "@/hooks/useThrone";
import { Coronation } from "./Coronation";
import type { PaymentHandle } from "./StripePayment";
import s from "./checkout.module.css";

const StripePayment = dynamic(() => import("./StripePayment"), {
  ssr: false,
  loading: () => <p className={s.paymentNote}>{copy.ui.coPaymentLoading}</p>,
});

const ui = copy.ui;

/** Default of "Email me if someone takes my throne" — an open legal question (PRD); privacy-safe off. */
const ALERT_DEFAULT = false;
const QUICK_LABEL = { minimum: "minimum", title: "title", x2: "×2", x5: "×5" } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Phase = "form" | "submitting" | "authorizing" | "waiting" | "done" | "failed";
type Field = "amount" | "name" | "proclamation" | "email" | "terms" | null;

export interface CheckoutProps {
  throne: ThroneId;
  reservation: CreateReservationResponse;
  prefillName: string;
  config: PublicConfig | null;
  now: number;
  king: ThroneState["king"];
  kingWasMine: boolean;
  money: Money;
  subscribeResult: (fn: (r: ReservationResult) => void) => () => void;
  /** Where focus goes back to when the sheet closes. */
  returnFocusTo: RefObject<HTMLElement | null>;
  /** The buyer was crowned (the page clears the try-on). */
  onCrowned: (reignId: string) => void;
  /** Our lock's end time changed (confirm extends it), so the page never shows our own lock as someone else's. */
  onLock: (expiresAtMs: number) => void;
  /** Close the sheet; `flash` is shown on the page (e.g. the lock ran out). */
  onClose: (flash: string | null) => void;
}

function failMessage(reason: FailReason | null, state: ReservationState): string {
  switch (reason) {
    case "outbid":
      return copy.errOutbid;
    case "capture_failed":
      return copy.errCaptureFailed;
    case "card_declined":
      return ui.errDeclinedFull;
    case "canceled":
      return ui.errCanceled;
    case "moderation":
      return ui.errModeration;
    case "banned":
      return ui.errBanned;
    case "expired":
    case "released":
      return copy.errExpired;
    default:
      return state === "expired" || state === "released" ? copy.errExpired : copy.errGeneric;
  }
}

export function CheckoutDialog(props: CheckoutProps) {
  const { throne, reservation, config, money } = props;
  const pricing = pricingOf(config);
  const nameMax = config?.nameMax ?? FALLBACK_LIMITS.nameMax;
  const procMax = config?.proclamationMax ?? FALLBACK_LIMITS.proclamationMax;
  const heartbeatMs = config?.heartbeatMs ?? FALLBACK_LIMITS.heartbeatMs;
  const minCents = reservation.minCents;
  const auth: ReservationAuth = { id: reservation.reservationId, token: reservation.reservationToken };
  const authRef = useRef(auth);

  const [phase, setPhase] = useState<Phase>("form");
  const phaseRef = useRef<Phase>("form");
  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);
  const [expiresAt, setExpiresAt] = useState(() => Date.parse(reservation.expiresAt));
  const [paying, setPaying] = useState(false); // server-side state is "paying" (confirm succeeded)

  const [amountText, setAmountText] = useState(() => centsToInput(minCents));
  const [name, setName] = useState(props.prefillName.slice(0, nameMax));
  const [proclamation, setProclamation] = useState("");
  const [email, setEmail] = useState("");
  const [alertOptIn, setAlertOptIn] = useState(ALERT_DEFAULT);
  const [terms, setTerms] = useState(false);
  const [outcome, setOutcome] = useState<"succeed" | "decline">("succeed");
  const [error, setError] = useState<{ text: string; field: Field } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [crowned, setCrowned] = useState<{ reignId: string; amountCents: number; name: string; url: string } | null>(null);
  const submitted = useRef<{ amountCents: number; name: string } | null>(null);

  const stripeRef = useRef<PaymentHandle | null>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const procRef = useRef<HTMLTextAreaElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const termsRef = useRef<HTMLInputElement | null>(null);
  const focusField = (f: Field) => {
    const el = { amount: amountRef, name: nameRef, proclamation: procRef, email: emailRef, terms: termsRef }[f ?? "name"];
    // After a failed submit the fields are re-enabled on the next render, so focus once that has happened.
    if (f) setTimeout(() => el.current?.focus(), 0);
  };

  const amountCents = parseAmountToCents(amountText);
  const help = amountHelp({ amountCents, minCents, maxCents: pricing.maxCents, money, nextOf: (c) => nextMinCents(c, pricing) });
  const shownCents = !help.bad && amountCents != null ? amountCents : minCents;
  const cleanName = normalizeText(name);
  const busy = phase === "submitting" || phase === "authorizing" || phase === "waiting";
  const stripeMode = reservation.paymentMode === "stripe";
  const stripeKey = config?.stripePublishableKey ?? null;

  // ---- reservation lifecycle ------------------------------------------------------------------

  const release = useCallback((keepalive = false) => {
    void getApi().then((api) => api.cancelReservation(authRef.current, { keepalive }));
  }, []);

  const close = useCallback(
    (flash: string | null = null) => {
      const p = phaseRef.current;
      if (p === "submitting" || p === "authorizing" || p === "waiting") return;
      if (p !== "done") release();
      props.onClose(flash);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [release, props.onClose],
  );

  const finish = useCallback(
    (reignId: string) => {
      if (phaseRef.current === "done") return;
      const sub = submitted.current;
      const paid = sub?.amountCents ?? minCents;
      const crownedName = props.king?.id === reignId ? props.king.name : (sub?.name ?? "");
      addMyReign(reignId);
      props.onCrowned(reignId);
      setCrowned({ reignId, amountCents: paid, name: crownedName, url: `${window.location.origin}/r/${reignId}` });
      go("done");
      track("takeover_completed", {
        throne,
        amount: paid,
        overpay: overpayPercent(paid, minCents),
        title: titleFor(paid),
        wasPreviousKing: props.kingWasMine ? "yes" : "no",
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [go, minCents, props.king, props.kingWasMine, props.onCrowned, throne],
  );

  const fail = useCallback(
    (message: string, reason: string) => {
      if (phaseRef.current === "done" || phaseRef.current === "failed") return;
      setFailure(message);
      go("failed");
      track("takeover_failed", { throne, reason });
    },
    [go, throne],
  );

  /** Applies a reservation state from the live channel, polling, heartbeat or a payment call. */
  const applyStatus = useCallback(
    (st: { state: ReservationState; failReason: FailReason | null; reignId: string | null }) => {
      if (st.state === "completed" && st.reignId) finish(st.reignId);
      else if (st.state === "failed" || st.state === "expired" || st.state === "released") {
        fail(failMessage(st.failReason, st.state), st.failReason ?? st.state);
      }
    },
    [finish, fail],
  );

  const { onLock } = props;
  useEffect(() => onLock(expiresAt), [onLock, expiresAt]);

  // Private reservation.result over the live channel.
  const { subscribeResult } = props;
  useEffect(
    () =>
      subscribeResult((r) => {
        if (r.reservationId === authRef.current.id) applyStatus(r);
      }),
    [subscribeResult, applyStatus],
  );

  // Heartbeat every 20 s while the reservation is open.
  const open = phase !== "done" && phase !== "failed";
  useEffect(() => {
    if (!open) return;
    const id = setInterval(async () => {
      const api = await getApi();
      const r = await api.heartbeat(authRef.current);
      if (r.ok) {
        setExpiresAt(Date.parse(r.data.expiresAt));
        applyStatus(r.data);
      } else if (r.status === 410 || r.status === 401) {
        if (phaseRef.current === "form") props.onClose(r.status === 410 ? copy.errExpired : ui.errLost);
        else fail(copy.errExpired, "expired");
      }
    }, heartbeatMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, heartbeatMs, applyStatus, fail]);

  // Poll every 2 s while waiting for the result (fallback for the live channel).
  useEffect(() => {
    if (phase !== "waiting") return;
    const id = setInterval(async () => {
      const api = await getApi();
      const r = await api.getReservation(authRef.current);
      if (r.ok) applyStatus(r.data);
    }, 2000);
    return () => clearInterval(id);
  }, [phase, applyStatus]);

  // The lock ran out before paying: close and say so (PRD failure table, 410).
  const lockLeft = expiresAt - props.now;
  const lockedOut = lockLeft <= 0 && phase === "form";
  useEffect(() => {
    if (lockedOut) close(copy.errExpired);
  }, [lockedOut, close]);

  // Closing the tab releases the reservation at once (AC-12) unless payment has started.
  useEffect(() => {
    const onHide = () => {
      if (phaseRef.current === "form" && !paying) release(true);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [release, paying]);

  const dialogRef = useModalDialog(() => close(), props.returnFocusTo);

  useEffect(() => {
    (props.prefillName ? amountRef : nameRef).current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- submit ---------------------------------------------------------------------------------

  function invalid(text: string, field: Field) {
    setError({ text, field });
    focusField(field);
  }

  function confirmError(r: Extract<ApiResult<ReservationStatus>, { ok: false }>): void {
    const e = r.error;
    const field = (typeof e.field === "string" ? e.field : null) as Field;
    go("form");
    if (r.status === 410) return fail(copy.errExpired, "expired");
    if (r.status === 401) return fail(ui.errLost, "lost");
    if (r.status === 403) return invalid(ui.errBanned, null);
    if (r.status === 503) return invalid(copy.errModerationUnavailable, null);
    if (r.status === 0) return invalid(ui.errNetwork, null);
    if (r.status === 422 && e.error === "amount") {
      return invalid(fill(copy.errAmount, { min: money(minCents), max: money(pricing.maxCents, true) }), "amount");
    }
    if (r.status === 422 && e.error === "moderation") {
      track("moderation_rejected", { field: field ?? "unknown", category: typeof e.category === "string" ? e.category : "unknown" });
      return invalid(e.message || ui.errModeration, field);
    }
    if (r.status === 422) return invalid(e.message || copy.errGeneric, field);
    invalid(copy.errGeneric, null);
  }

  async function pay() {
    if (busy || phase !== "form") return;
    setError(null);
    if (help.bad || amountCents == null) {
      return invalid(fill(copy.errAmount, { min: money(minCents), max: money(pricing.maxCents, true) }), "amount");
    }
    if (!cleanName) return invalid(ui.errNameRequired, "name");
    if (textLength(cleanName) > nameMax) return invalid(fill(ui.errNameLong, { max: nameMax }), "name");
    const cleanProc = normalizeText(proclamation);
    if (textLength(cleanProc) > procMax) return invalid(fill(ui.errProclamationLong, { max: procMax }), "proclamation");
    if (!EMAIL_RE.test(email.trim())) return invalid(ui.errEmail, "email");
    if (!terms) return invalid(ui.errTerms, "terms");
    if (stripeMode && !stripeRef.current) return invalid(ui.coPaymentUnavailable, null);

    go("submitting");
    if (stripeMode) {
      const msg = await stripeRef.current!.submit();
      if (msg) {
        go("form");
        return invalid(msg, null);
      }
    }

    const api = await getApi();
    track("payment_submitted", { throne, amount: amountCents, overpay: overpayPercent(amountCents, minCents) });
    submitted.current = { amountCents, name: cleanName };
    const res = await api.confirm(authRef.current, {
      amountCents,
      name: cleanName,
      proclamation: cleanProc,
      email: email.trim(),
      alertOptIn,
      termsAccepted: terms,
    });
    if (!res.ok) return confirmError(res);
    setPaying(true);
    setExpiresAt(Date.parse(res.data.expiresAt));

    go("authorizing");
    if (stripeMode) {
      const returnUrl = `${window.location.origin}${window.location.pathname}`;
      const msg = await stripeRef.current!.confirm(reservation.clientSecret, returnUrl);
      if (msg) {
        go("form");
        return invalid(msg, null);
      }
      go("waiting");
      return;
    }

    const r = await api.fakePay(authRef.current, outcome);
    if (!r.ok) {
      go("form");
      return invalid(r.status === 0 ? ui.errNetwork : copy.errGeneric, null);
    }
    if (r.data.state === "completed" || r.data.state === "failed" || r.data.state === "expired" || r.data.state === "released") {
      go("waiting");
      return applyStatus(r.data);
    }
    if (r.data.failReason === "card_declined") {
      go("form");
      return invalid(ui.errDeclinedFull, null);
    }
    go("waiting");
  }

  // ---- render ---------------------------------------------------------------------------------

  const chips = chipOptions(minCents, pricing.maxCents);
  const procLen = textLength(proclamation);
  const errId = error ? "coError" : undefined;
  const invalidField = (f: Field) => (error?.field === f ? true : undefined);

  let body: React.ReactNode;
  if (phase === "done" && crowned) {
    const title = titleFor(crowned.amountCents);
    body = (
      <Coronation
        title={title}
        name={crowned.name}
        paid={money(crowned.amountCents)}
        next={money(nextMinCents(crowned.amountCents, pricing))}
        throneLabel={copy.throneLabel[throne]}
        reignUrl={crowned.url}
        onClose={() => props.onClose(null)}
      />
    );
  } else if (phase === "waiting") {
    body = (
      <div className={`${s.sheet} ${s.done}`} role="status">
        <div className={s.spinner} aria-hidden="true" />
        <h2 className={s.doneName} id="waitTitle">
          {ui.waiting}
        </h2>
        <p className={s.doneText}>{ui.waitingDetail}</p>
      </div>
    );
  } else if (phase === "failed") {
    body = (
      <div className={s.sheet}>
        <h2 id="failTitle">{ui.failedHeading}</h2>
        <p className={s.error} role="alert">
          {failure}
        </p>
        <div className={s.actions}>
          <button type="button" className={s.btnSecondary} onClick={() => close()} autoFocus>
            {ui.coClose}
          </button>
        </div>
      </div>
    );
  } else {
    const lockText = fill(ui.lockLine, { price: money(minCents), clock: formatClock(lockLeft) });
    body = (
      <form
        className={s.sheet}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void pay();
        }}
      >
        <h2 id="coTitle">{fill(copy.checkoutHeading, { throneLabel: copy.throneLabel[throne] })}</h2>
        <div className={s.coHead}>
          <Crest key={crestHash(cleanName.toLowerCase())} name={cleanName || null} idPrefix="co" className={s.crestLg} />
          <div>
            <p className={s.coKicker}>{ui.coKicker}</p>
            <p className={s.coName} aria-live="polite">
              {fill(copy.hallName, { title: titleFor(shownCents), name: cleanName || ui.coYou })}
            </p>
          </div>
        </div>

        <label className={s.field} htmlFor="amountInput">
          {ui.coPrice}
        </label>
        <div className={s.amount}>
          <span className={s.amountCur} aria-hidden="true">
            €
          </span>
          <input
            ref={amountRef}
            id="amountInput"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-describedby="amountHelp lockline"
            aria-invalid={help.bad || invalidField("amount")}
            disabled={busy}
          />
        </div>
        <div className={s.chips} role="group" aria-label={ui.coQuickPrices}>
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              className={s.chip}
              aria-pressed={amountCents === c.cents}
              disabled={busy}
              onClick={() => {
                setAmountText(centsToInput(c.cents));
                track("quick_price_tapped", { label: QUICK_LABEL[c.key] });
              }}
            >
              <span className={s.chipLabel}>{c.label}</span>
              <span className={s.chipAmount}>{money(c.cents, c.cents % 100 === 0)}</span>
            </button>
          ))}
        </div>
        <p id="amountHelp" className={`${s.amountHelp} ${help.bad ? s.isBad : ""}`} aria-live="polite">
          {help.text}
        </p>
        <p id="lockline" className={s.lockline}>
          {lockText}
        </p>

        <label className={s.field} htmlFor="nameInput">
          {ui.coName}
        </label>
        <input
          ref={nameRef}
          id="nameInput"
          type="text"
          maxLength={nameMax}
          autoComplete="nickname"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={invalidField("name")}
          aria-describedby={error?.field === "name" ? errId : undefined}
          disabled={busy}
        />

        <label className={s.field} htmlFor="msgInput">
          {ui.coProclamation}
        </label>
        <textarea
          ref={procRef}
          id="msgInput"
          rows={3}
          maxLength={procMax}
          placeholder={ui.coProclamationPlaceholder}
          value={proclamation}
          onChange={(e) => setProclamation(e.target.value)}
          aria-invalid={invalidField("proclamation")}
          aria-describedby="msgCount"
          disabled={busy}
        />
        <div id="msgCount" className={s.count}>
          {fill(ui.coCount, { n: procLen, max: procMax })}
        </div>

        <label className={s.field} htmlFor="emailInput">
          {ui.coEmail}
        </label>
        <input
          ref={emailRef}
          id="emailInput"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={invalidField("email")}
          disabled={busy}
        />

        <label className={s.check}>
          <input type="checkbox" checked={alertOptIn} onChange={(e) => setAlertOptIn(e.target.checked)} disabled={busy} />
          <span>{ui.coAlert}</span>
        </label>
        <label className={s.check}>
          <input
            ref={termsRef}
            type="checkbox"
            required
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            aria-invalid={invalidField("terms")}
            disabled={busy}
          />
          <span>
            {ui.coTermsBefore}
            <a href="/legal/terms" target="_blank" rel="noopener">
              {ui.coTermsLink}
            </a>
            {ui.coTermsAfter}
          </span>
        </label>

        <fieldset className={s.payment} disabled={busy}>
          <legend>{ui.coPaymentLegend}</legend>
          {stripeMode ? (
            stripeKey ? (
              <StripePayment publishableKey={stripeKey} amountCents={shownCents} handleRef={stripeRef} />
            ) : (
              <p className={s.paymentNote}>{config ? ui.coPaymentUnavailable : ui.coPaymentLoading}</p>
            )
          ) : (
            <div className={s.testCard}>
              <h3>
                <span className={s.testBadge}>{ui.fakeBadge}</span>
                {ui.fakeHeading}
              </h3>
              <p className={s.paymentNote}>{ui.fakeIntro}</p>
              <div className={s.segmented} role="radiogroup" aria-label={ui.fakeOutcome}>
                {(["succeed", "decline"] as const).map((o) => (
                  <label key={o}>
                    <input type="radio" name="fakeOutcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} />
                    {o === "succeed" ? ui.fakeSucceed : ui.fakeDecline}
                  </label>
                ))}
              </div>
            </div>
          )}
        </fieldset>

        {error && (
          <p id="coError" className={s.error} role="alert">
            {error.text}
          </p>
        )}
        <div className={s.actions}>
          <button type="submit" className={s.payBtn} disabled={busy || help.bad}>
            {busy ? ui.coProcessing : fill(ui.coPay, { price: money(shownCents) })}
          </button>
          <button type="button" className={s.btnSecondary} onClick={() => close()} disabled={busy}>
            {ui.coCancel}
          </button>
        </div>
      </form>
    );
  }

  const labelledBy = phase === "done" ? "doneTitle" : phase === "waiting" ? "waitTitle" : phase === "failed" ? "failTitle" : "coTitle";
  return (
    <dialog ref={dialogRef} className={`${s.dialog} ${phase === "done" || phase === "waiting" ? s.isDone : ""}`} aria-labelledby={labelledBy}>
      {body}
    </dialog>
  );
}
