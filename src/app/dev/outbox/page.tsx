// OWNER: G. Dev outbox: every email decision from email_log (sent, dropped, failed) with the
// rendered email for those that went to the local outbox. 404 in production.
import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { customers, emailLog } from "@/server/db/schema";
import { readOutboxHtml, readOutboxMeta } from "@/server/email/outbox";
import { getEmailProvider } from "@/server/email/provider";
import { simulateOverthrow } from "./actions";
import s from "./outbox.module.css";

export const metadata: Metadata = { title: "Dev outbox · The Throne", robots: { index: false } };

type Props = { searchParams: Promise<{ id?: string }> };

export default async function OutboxPage({ searchParams }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  await connection();
  const { id: selectedId } = await searchParams;

  const db = await getDb();
  const rows = await db
    .select({ log: emailLog, email: customers.email })
    .from(emailLog)
    .leftJoin(customers, eq(emailLog.customerId, customers.id))
    .orderBy(desc(emailLog.sentAt))
    .limit(100);
  const metas = await Promise.all(rows.map((r) => (r.log.providerMessageId ? readOutboxMeta(r.log.providerMessageId) : null)));
  const selected = selectedId ? await readOutboxMeta(selectedId) : null;
  // Inline the HTML (srcdoc) instead of framing /dev/outbox/<id>: a sandboxed frame has an opaque
  // origin, so framing it depends on response headers and breaks with frame-ancestors / XFO.
  const selectedHtml = selected ? await readOutboxHtml(selected.id) : null;

  return (
    <main className={s.page}>
      <h1 className={s.h1}>Dev outbox</h1>
      <p className={s.muted}>
        Provider: <strong>{getEmailProvider().name}</strong>. Emails land here when <code>RESEND_API_KEY</code> is not set
        (files in <code>.data/outbox</code>). Dropped rows are overthrow emails swallowed by the 15-minute limit.
      </p>

      <form action={simulateOverthrow} className={s.sim}>
        <fieldset>
          <legend>Simulate an overthrow (writes reigns straight into the dev DB)</legend>
          <label>
            Throne
            <select name="throne" defaultValue="eternal">
              <option value="eternal">Eternal</option>
              <option value="daily">Daily</option>
            </select>
          </label>
          <label>
            Old king <input name="oldName" defaultValue="Alice" maxLength={24} />
          </label>
          <label>
            Old king email <input name="oldEmail" defaultValue="alice@example.test" type="email" />
          </label>
          <label>
            New king <input name="newName" defaultValue="Bob" maxLength={24} />
          </label>
          <label>
            New king email <input name="newEmail" defaultValue="bob@example.test" type="email" />
          </label>
          <button type="submit">Run two takeovers</button>
        </fieldset>
      </form>

      <div className={s.layout}>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Sent (UTC)</th>
                <th>Type</th>
                <th>Status</th>
                <th>To</th>
                <th>Subject</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>No emails yet.</td>
                </tr>
              ) : null}
              {rows.map((r, i) => {
                const meta = metas[i];
                const active = meta && meta.id === selectedId;
                return (
                  <tr key={r.log.id} className={active ? s.active : undefined}>
                    <td className={s.nowrap}>{r.log.sentAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                    <td>{r.log.type}</td>
                    <td className={s[`status_${r.log.status}`]}>{r.log.status}</td>
                    <td>{meta?.to ?? r.email ?? "—"}</td>
                    <td>{meta ? <Link href={`/dev/outbox?id=${meta.id}`}>{meta.subject}</Link> : <span className={s.muted}>—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selected ? (
          <section className={s.viewer} aria-label="Selected email">
            <dl className={s.headers}>
              <dt>From</dt>
              <dd>{selected.from}</dd>
              <dt>To</dt>
              <dd>{selected.to}</dd>
              <dt>Subject</dt>
              <dd>{selected.subject}</dd>
              {Object.entries(selected.headers).map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt>{k}</dt>
                  <dd className={s.break}>{v}</dd>
                </div>
              ))}
            </dl>
            <iframe
              className={s.frame}
              srcDoc={selectedHtml ?? ""}
              title={selected.subject}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
            />
            <a href={`/dev/outbox/${selected.id}`} target="_blank" rel="noreferrer">
              Open in a new tab
            </a>
            <details>
              <summary>Plain text</summary>
              <pre className={s.text}>{selected.text}</pre>
            </details>
          </section>
        ) : null}
      </div>
    </main>
  );
}
