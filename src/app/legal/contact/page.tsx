// OWNER: G. Contact page: support, takedown notices and data requests.
import type { Metadata } from "next";
import { supportEmail } from "@/server/email/provider";
import { LegalDoc, Todo } from "../_doc";

export const metadata: Metadata = { title: "Contact · The Throne" };

export default function ContactPage() {
  const email = supportEmail();
  return (
    <LegalDoc slug="contact">
      <h2>Support</h2>
      <p>
        Questions about a payment, a receipt or your reign: <a href={`mailto:${email}`}>{email}</a>. Please include the
        reference from your receipt. <Todo what="confirm the public support address" />
      </p>

      <h2>Report content</h2>
      <p>
        Use the report button next to the king on the throne. For legal notices (for example impersonation or
        infringement), write to <Todo what="notices address" /> with a link to the reign and the reason.
      </p>

      <h2>Your data</h2>
      <p>
        To get a copy of your data or have it deleted, write from the email address you used at checkout to{" "}
        <a href={`mailto:${email}`}>{email}</a>. <Todo what="identity verification process and response time" />
      </p>

      <h2>Postal address</h2>
      <p>
        <Todo what="postal address" />
      </p>
    </LegalDoc>
  );
}
