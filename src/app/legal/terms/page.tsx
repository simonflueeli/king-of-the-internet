// OWNER: G. Terms (placeholder structure per PRD "Legal and compliance").
import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, Todo } from "../_doc";

export const metadata: Metadata = { title: "Terms · The Throne" };

export default function TermsPage() {
  return (
    <LegalDoc slug="terms">
      <h2>1. Who we are</h2>
      <p>
        The Throne is operated by <Todo what="operator name and legal form" />, <Todo what="address" /> (“we”). See
        the <Link href="/legal/imprint">imprint</Link> for full details.
      </p>

      <h2>2. What you are buying</h2>
      <ul>
        <li>
          You are buying <strong>display time</strong>: your name, title and optional proclamation are shown on a public
          throne until someone else pays at least the minimum price, a daily reset ends your reign (Daily Throne), or we
          remove it under these terms.
        </li>
        <li>There is no guaranteed duration. You may be overthrown seconds after you pay.</li>
        <li>
          It is not a prize, lottery, bet or investment. We never pay anything to previous or current kings, and there is
          no refund when you are overthrown.
        </li>
        <li>Your title (Lord to Emperor) depends only on the amount you paid. Prices are set by the server and shown before you pay.</li>
      </ul>

      <h2>3. Who can buy</h2>
      <p>You must be 18 or older. By buying you confirm that you are. <Todo what="any country restrictions" /></p>

      <h2>4. Immediate performance and right of withdrawal</h2>
      <p>
        Your name goes on the throne as soon as payment is captured. <Todo what="wording on immediate performance and the loss of the right of withdrawal for EU consumers, matching the checkout checkbox" />
      </p>

      <h2>5. What you may put on the throne</h2>
      <ul>
        <li>No links, contact details, hate, harassment, sexual content or anything illegal.</li>
        <li>No impersonation of real people, companies or brands. <Todo what="policy on company and brand names" /></li>
        <li>Names and proclamations are checked automatically before payment and can be reported by anyone afterwards.</li>
      </ul>

      <h2>6. Removal</h2>
      <p>
        We may remove a reign that breaks these terms or the law. When we do, the reign ends, the throne may become
        vacant, and we tell you the reason category by email. <Todo what="whether removals are refunded" /> See the{" "}
        <Link href="/legal/refunds">refund policy</Link>.
      </p>

      <h2>7. Emails</h2>
      <p>
        We send you a receipt. If you opt in at checkout, we also email you when someone takes your seat. You can
        unsubscribe from those emails with one click at any time.
      </p>

      <h2>8. Payments</h2>
      <p>
        Payments are processed by Stripe. Card details never reach our servers. Prices include VAT where applicable.{" "}
        <Todo what="VAT treatment and currency" />
      </p>

      <h2>9. Liability</h2>
      <p>
        <Todo what="limitation of liability" />
      </p>

      <h2>10. Governing law and disputes</h2>
      <p>
        <Todo what="governing law, jurisdiction, consumer dispute resolution" />
      </p>

      <h2>11. Changes</h2>
      <p>
        <Todo what="how changes to these terms are announced" />
      </p>
    </LegalDoc>
  );
}
