// OWNER: G. Email templates: HTML with inline styles (stage look from the prototype) plus a
// plain-text part. Every user-supplied string is escaped; subjects never contain line breaks.
import { copy, fill } from "@/lib/copy";
import type { ThroneId, Title } from "@/lib/contracts";
import { formatMoney } from "@/lib/format";
import { appUrl, reignUrl } from "./links";
import { supportEmail } from "./provider";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Server-rendered emails use one fixed locale (no browser to take it from). */
export const EMAIL_LOCALE = "en-IE";

const C = {
  page: "#0A0D28",
  stage: "#121A5C",
  onStage: "#F5F4FB",
  onStageSoft: "#BFC4EA",
  gold: "#E2B04A",
  goldHi: "#FFE7A0",
  goldText: "#F2C75C",
  goldInk: "#231803",
  goldEdge: "#835610",
  line: "#283068",
};
const SANS = "'Schibsted Grotesk',system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BLACKLETTER = "'UnifrakturMaguntia','Old English Text MT',Georgia,serif";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
const money = (cents: number) => formatMoney(cents, { locale: EMAIL_LOCALE });

/** "28 Oct 2026, 14:03 UTC" */
export function formatUtcDateTime(d: Date): string {
  const date = d.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}, ${time} UTC`;
}

/** "impersonation" / "spam_link" → "Impersonation" / "Spam link" */
export function humanizeCategory(category: string): string {
  const s = category.replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Other";
}

function button(href: string, label: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto 8px;"><tr>` +
    `<td align="center" bgcolor="${C.gold}" style="border-radius:16px;background-color:${C.gold};` +
    `background-image:linear-gradient(180deg,#FFE6A3 0%,#EDBC4C 47%,#D69E2C 53%,#E9B848 100%);` +
    `border:1px solid #9C6B12;border-bottom:6px solid ${C.goldEdge};">` +
    `<a href="${escapeHtml(href)}" style="display:inline-block;padding:16px 28px;font-family:${SANS};font-size:19px;` +
    `font-weight:800;line-height:1.2;color:${C.goldInk};text-decoration:none;">&#9813;&nbsp; ${escapeHtml(label)}</a>` +
    `</td></tr></table>`
  );
}

function paragraph(html: string, opts?: { soft?: boolean; size?: number; center?: boolean }): string {
  return (
    `<p style="margin:0 0 16px;font-family:${SANS};font-size:${opts?.size ?? 17}px;line-height:1.55;` +
    `color:${opts?.soft ? C.onStageSoft : C.onStage};${opts?.center ? "text-align:center;" : ""}">${html}</p>`
  );
}

function hallName(title: Title, name: string): string {
  return (
    `<h1 style="margin:4px 0 18px;font-family:${BLACKLETTER};font-weight:400;font-size:40px;line-height:1.1;` +
    `color:${C.goldText};text-align:center;overflow-wrap:anywhere;">${escapeHtml(`${title} ${name}`)}</h1>`
  );
}

function hero(reignId: string, alt: string): string {
  return (
    `<img src="${escapeHtml(appUrl(`/og/r/${reignId}`))}" width="520" alt="${escapeHtml(alt)}" ` +
    `style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:12px;margin:0 auto 22px;">`
  );
}

function layout(o: { preheader: string; body: string; footer: string[] }): string {
  const footer = o.footer
    .map((f) => `<p style="margin:0 0 8px;font-family:${SANS};font-size:13px;line-height:1.5;color:#A4A8C8;">${f}</p>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;700;800&family=UnifrakturMaguntia&display=swap" rel="stylesheet">
<title>${escapeHtml(copy.brand)}</title></head>
<body style="margin:0;padding:0;background-color:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background-color:${C.page};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td bgcolor="${C.stage}" style="background-color:${C.stage};background-image:radial-gradient(ellipse 80% 50% at 50% 0%,rgba(255,214,120,.22),rgba(255,214,120,0) 70%);border-top:3px solid ${C.gold};border-radius:16px;padding:26px 28px 30px;">
<p style="margin:0 0 18px;font-family:${BLACKLETTER};font-size:28px;line-height:1;color:${C.goldText};text-align:center;">${escapeHtml(copy.brand)}</p>
${o.body}
</td></tr>
<tr><td style="padding:20px 8px 0;text-align:center;">${footer}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function footerLinks(): string {
  const link = (href: string, label: string) =>
    `<a href="${escapeHtml(appUrl(href))}" style="color:#BFC4EA;text-decoration:underline;">${escapeHtml(label)}</a>`;
  return `${link("/legal/terms", copy.growth.termsLink)} · ${link("/legal/contact", copy.growth.contactLink)}`;
}

function supportLine(): { html: string; text: string } {
  const email = supportEmail();
  const html = escapeHtml(copy.growth.emailSupport).replace(
    "{email}",
    `<a href="mailto:${escapeHtml(email)}" style="color:#BFC4EA;">${escapeHtml(email)}</a>`,
  );
  return { html, text: fill(copy.growth.emailSupport, { email }) };
}

// ---------------------------------------------------------------------------------------------

export interface ReceiptInput {
  throne: ThroneId;
  title: Title;
  name: string;
  paidCents: number;
  at: Date;
  reignId: string;
}

export function renderReceipt(i: ReceiptInput): RenderedEmail {
  const g = copy.growth;
  const throneName = copy.throneName[i.throne];
  const rows: [string, string][] = [
    [g.receiptRows.throne, throneName],
    [g.receiptRows.title, i.title],
    [g.receiptRows.name, i.name],
    [g.receiptRows.amount, money(i.paidCents)],
    [g.receiptRows.date, formatUtcDateTime(i.at)],
    [g.receiptRows.reference, i.reignId],
  ];
  const table =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;border-collapse:collapse;">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:9px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:15px;color:${C.onStageSoft};">${escapeHtml(k)}</td>` +
          `<td align="right" style="padding:9px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:15px;font-weight:700;color:${C.onStage};font-variant-numeric:tabular-nums;overflow-wrap:anywhere;">${escapeHtml(v)}</td></tr>`,
      )
      .join("") +
    `</table>`;
  const support = supportLine();
  const link = reignUrl(i.reignId);
  const heading = fill(g.receiptHeading, { title: i.title, name: i.name });
  const intro = fill(g.receiptIntro, { throneLabel: copy.throneLabel[i.throne] });

  const html = layout({
    preheader: intro,
    body:
      hero(i.reignId, heading) +
      hallName(i.title, i.name) +
      paragraph(escapeHtml(intro), { center: true }) +
      table +
      paragraph(escapeHtml(g.receiptVatLine), { soft: true, size: 14 }) +
      button(link, g.receiptReignLink) +
      paragraph(escapeHtml(g.receiptOutro), { soft: true, size: 14, center: true }),
    footer: [support.html, footerLinks(), escapeHtml(g.emailFooter)],
  });
  const text = [
    heading,
    "",
    intro,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    g.receiptVatLine,
    "",
    `${g.receiptReignLink}: ${link}`,
    "",
    g.receiptOutro,
    "",
    support.text,
  ].join("\n");
  return { subject: oneLine(fill(g.receiptSubject, { title: i.title, name: i.name })), html, text };
}

export interface OverthrowInput {
  throne: ThroneId;
  newTitle: Title;
  newName: string;
  newReignId: string;
  priceCents: number;
  reclaimUrl: string;
  unsubscribeUrl: string;
}

export function renderOverthrow(i: OverthrowInput): RenderedEmail {
  const g = copy.growth;
  const body = fill(g.overthrowBody, {
    title: i.newTitle,
    name: i.newName,
    throneLabel: copy.throneLabel[i.throne],
    price: money(i.priceCents),
  });
  const unsubscribe =
    `<a href="${escapeHtml(i.unsubscribeUrl)}" style="color:#BFC4EA;text-decoration:underline;">${escapeHtml(g.overthrowUnsubscribe)}</a>`;
  const html = layout({
    preheader: body,
    body:
      hero(i.newReignId, `${i.newTitle} ${i.newName}`) +
      paragraph(escapeHtml(body), { size: 19, center: true }) +
      button(i.reclaimUrl, copy.overthrowButton) +
      paragraph(escapeHtml(g.overthrowPriceNote), { soft: true, size: 13, center: true }),
    footer: [escapeHtml(g.overthrowFooter), unsubscribe, footerLinks()],
  });
  const text = [
    body,
    "",
    `${copy.overthrowButton}: ${i.reclaimUrl}`,
    "",
    g.overthrowPriceNote,
    "",
    g.overthrowFooter,
    `${g.overthrowUnsubscribe}: ${i.unsubscribeUrl}`,
  ].join("\n");
  return { subject: copy.overthrowSubject, html, text };
}

export interface RemovalInput {
  throne: ThroneId;
  title: Title;
  name: string;
  reasonCategory: string;
}

export function renderRemoval(i: RemovalInput): RenderedEmail {
  const g = copy.growth;
  const body = fill(g.removalBody, {
    title: i.title,
    name: i.name,
    throneLabel: copy.throneLabel[i.throne],
    reason: humanizeCategory(i.reasonCategory),
  });
  const support = supportLine();
  const html = layout({
    preheader: body,
    body: paragraph(escapeHtml(body)) + paragraph(escapeHtml(g.removalOutro), { soft: true }),
    footer: [support.html, footerLinks()],
  });
  const text = [body, "", g.removalOutro, "", support.text, `${g.termsLink}: ${appUrl("/legal/terms")}`].join("\n");
  return { subject: g.removalSubject, html, text };
}

export interface RefundInput {
  throne: ThroneId;
  title: Title;
  name: string;
  amountCents: number;
}

export function renderRefund(i: RefundInput): RenderedEmail {
  const g = copy.growth;
  const body = fill(g.refundBody, {
    amount: money(i.amountCents),
    title: i.title,
    name: i.name,
    throneLabel: copy.throneLabel[i.throne],
  });
  const support = supportLine();
  const html = layout({
    preheader: body,
    body: paragraph(escapeHtml(body)) + paragraph(escapeHtml(g.refundTiming), { soft: true }),
    footer: [support.html, footerLinks()],
  });
  const text = [body, "", g.refundTiming, "", support.text].join("\n");
  return { subject: g.refundSubject, html, text };
}
