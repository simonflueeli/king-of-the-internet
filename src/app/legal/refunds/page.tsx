// OWNER: G. Refund policy.
import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, Todo } from "../_doc";

export const metadata: Metadata = { title: "Refund policy · The Throne" };

export default function RefundsPage() {
  return (
    <LegalDoc slug="refunds">
      <h2>Being overthrown</h2>
      <p>
        There is no refund when someone takes your seat or when the Daily Throne resets. That is how the throne works:
        you bought display time with no guaranteed duration.
      </p>

      <h2>Failed payments</h2>
      <p>
        If your payment does not go through, or someone else takes the throne while you are paying, your card is not
        charged. Any authorization is released by your bank, usually within a few days.
      </p>

      <h2>Removals</h2>
      <p>
        If we remove your reign because it breaks the <Link href="/legal/terms">terms</Link>, we email you the reason
        category. <Todo what="whether and when removals are refunded" />
      </p>

      <h2>Mistakes and right of withdrawal</h2>
      <p>
        <Todo what="refunds for duplicate or mistaken payments, and the right of withdrawal for EU consumers" />
      </p>

      <h2>Timing</h2>
      <p>
        When we issue a refund, we confirm it by email. Refunds usually appear on your statement within 5–10 business
        days, depending on your bank.
      </p>

      <h2>Chargebacks</h2>
      <p>
        Please <Link href="/legal/contact">contact us</Link> before disputing a payment with your bank. A disputed payment
        ends the reign. <Todo what="dispute policy" />
      </p>
    </LegalDoc>
  );
}
