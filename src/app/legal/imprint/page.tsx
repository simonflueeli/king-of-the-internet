// OWNER: G. Imprint (operator details required for commercial sites in several countries).
import type { Metadata } from "next";
import { LegalDoc, Todo, legalStyles as s } from "../_doc";

export const metadata: Metadata = { title: "Imprint · The Throne" };

export default function ImprintPage() {
  const rows: [string, string][] = [
    ["Operator", "legal name and legal form"],
    ["Address", "registered address"],
    ["Represented by", "managing director(s)"],
    ["Commercial register", "court and registration number"],
    ["VAT ID", "VAT identification number"],
    ["Email", "contact email"],
    ["Phone", "contact phone"],
    ["Responsible for content", "name and address"],
  ];
  return (
    <LegalDoc slug="imprint">
      <dl className={s.dl}>
        {rows.map(([label, what]) => (
          <div key={label} style={{ display: "contents" }}>
            <dt>{label}</dt>
            <dd>
              <Todo what={what} />
            </dd>
          </div>
        ))}
      </dl>
      <h2>Content on the throne</h2>
      <p>
        Names and proclamations on the throne are written by buyers. To report content, use the report button on the
        throne or the contact details above. <Todo what="notice-and-takedown contact point required in the operator's jurisdiction" />
      </p>
    </LegalDoc>
  );
}
