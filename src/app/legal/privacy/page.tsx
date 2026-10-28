// OWNER: G. Privacy policy (placeholder structure per PRD "Legal and compliance" and "Privacy").
import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, Todo } from "../_doc";

export const metadata: Metadata = { title: "Privacy · The Throne" };

export default function PrivacyPage() {
  return (
    <LegalDoc slug="privacy">
      <h2>Controller</h2>
      <p>
        <Todo what="controller name, address and contact; data protection officer if any" />
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Your email address, to send your receipt and, if you opt in, overthrow emails.</li>
        <li>The name and proclamation you enter. These are public while you are on the throne and in the reign history.</li>
        <li>Payment metadata from Stripe (amount, status, card country and a card fingerprint used against fraud). We never see your card number.</li>
        <li>A salted hash of your IP address and a random device id in a first-party cookie, used only to limit abuse.</li>
        <li>Cookieless product analytics: which buttons are used, without any identifier.</li>
      </ul>
      <p>Your email address is never shown publicly.</p>

      <h2>Why, and on what legal basis</h2>
      <ul>
        <li>Providing the throne and receipts: <Todo what="legal basis (e.g. contract)" /></li>
        <li>Overthrow emails: your consent at checkout, recorded with a timestamp. <Todo what="confirm basis" /></li>
        <li>Moderation, fraud and abuse prevention: <Todo what="legal basis (e.g. legitimate interests)" /></li>
        <li>Tax and accounting records: <Todo what="legal obligation and retention period" /></li>
      </ul>

      <h2>Processors</h2>
      <ul>
        <li>Stripe (payments)</li>
        <li>Resend (email delivery)</li>
        <li>Anthropic (automated checks of names and proclamations)</li>
        <li>
          <Todo what="hosting and database providers, locations and transfer safeguards" />
        </li>
      </ul>

      <h2>How long we keep it</h2>
      <ul>
        <li>Moderation records: 180 days.</li>
        <li>Reigns (name, proclamation, title, amount and times) stay in the public history unless removed.</li>
        <li>
          <Todo what="retention for customers, payments and email logs" />
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can ask for a copy of your data or for its deletion at any time through the{" "}
        <Link href="/legal/contact">contact page</Link>. Overthrow emails stop with one click on the unsubscribe link.{" "}
        <Todo what="full list of rights and supervisory authority" />
      </p>

      <h2>Cookies</h2>
      <p>
        We set one first-party cookie (<code>kti_device</code>) with a random id used only for abuse limits. We do not
        use tracking or advertising cookies.
      </p>
    </LegalDoc>
  );
}
