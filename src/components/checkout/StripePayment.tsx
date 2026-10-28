// OWNER: U. Stripe Payment Element (paymentMode "stripe"). Loaded with next/dynamic only in Stripe mode.
// Uses the deferred-intent setup (mode "payment", manual capture) so wallets show the amount the buyer
// picked; the PaymentIntent created with the reservation is confirmed with its client secret.
"use client";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe, type StripeElementsOptions } from "@stripe/stripe-js";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { copy } from "@/lib/copy";
import s from "./checkout.module.css";

export interface PaymentHandle {
  /** Validates the payment form (and opens wallet sheets). Returns an error message or null. */
  submit(): Promise<string | null>;
  /** Authorizes the card for the reservation's PaymentIntent. Returns an error message or null. */
  confirm(clientSecret: string, returnUrl: string): Promise<string | null>;
}

const stripePromises = new Map<string, Promise<Stripe | null>>();
function stripeFor(key: string): Promise<Stripe | null> {
  let p = stripePromises.get(key);
  if (!p) {
    p = loadStripe(key);
    stripePromises.set(key, p);
  }
  return p;
}

function Inner({ amountCents, handleRef }: { amountCents: number; handleRef: RefObject<PaymentHandle | null> }) {
  const stripe = useStripe();
  const elements = useElements();

  useEffect(() => {
    if (elements && amountCents >= 50) elements.update({ amount: amountCents });
  }, [elements, amountCents]);

  useEffect(() => {
    if (!stripe || !elements) return;
    handleRef.current = {
      async submit() {
        const { error } = await elements.submit();
        return error ? (error.message ?? copy.errGeneric) : null;
      },
      async confirm(clientSecret, returnUrl) {
        const { error } = await stripe.confirmPayment({
          elements,
          clientSecret,
          confirmParams: { return_url: returnUrl },
          redirect: "if_required",
        });
        if (!error) return null;
        if (error.type === "card_error" || error.type === "validation_error") {
          return `${error.message ?? ""} ${copy.errDeclined}`.trim();
        }
        return error.message ?? copy.errGeneric;
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [stripe, elements, handleRef]);

  return <PaymentElement options={{ layout: "tabs", wallets: { applePay: "auto", googlePay: "auto" } }} />;
}

export default function StripePayment({
  publishableKey,
  amountCents,
  handleRef,
}: {
  publishableKey: string;
  amountCents: number;
  handleRef: RefObject<PaymentHandle | null>;
}) {
  const stripePromise = useMemo(() => stripeFor(publishableKey), [publishableKey]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    stripePromise.then(
      (st) => {
        if (alive && !st) setFailed(true);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [stripePromise]);

  // Options are read once by <Elements>; later amount changes go through elements.update() in Inner.
  const [options] = useState<StripeElementsOptions>(() => {
    const dark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return {
      mode: "payment",
      amount: Math.max(50, amountCents),
      currency: "eur",
      captureMethod: "manual",
      appearance: {
        theme: dark ? "night" : "stripe",
        variables: { colorPrimary: "#E2B04A", borderRadius: "10px" },
      },
    };
  });

  if (failed) return <p className={s.error}>{copy.ui.coPaymentUnavailable}</p>;
  return (
    <Elements stripe={stripePromise} options={options}>
      <Inner amountCents={amountCents} handleRef={handleRef} />
    </Elements>
  );
}
