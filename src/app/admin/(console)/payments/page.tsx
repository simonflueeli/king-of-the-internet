// OWNER: S. /admin/payments — recent payments with AD-04 refunds.
import { RefundForm } from "@/components/admin/forms";
import { money, shortId, utc } from "@/components/admin/format";
import s from "@/components/admin/admin.module.css";
import { listPayments } from "@/server/admin/ops";
import { getDb } from "@/server/db/client";
import { thrones } from "@/server/db/schema";

export default async function AdminPaymentsPage() {
  const [rows, throneRows] = await Promise.all([
    listPayments(100),
    getDb().then((db) => db.select({ current: thrones.currentReignId }).from(thrones)),
  ]);
  const current = new Set(throneRows.map((t) => t.current).filter(Boolean));
  return (
    <>
      <h1 className={s.h1}>Payments</h1>
      <p className={`${s.muted} ${s.small}`}>
        No refunds for being overthrown. Refund only for system errors or legal requirements. Refunding the current
        reign removes the king.
      </p>
      {rows.length === 0 ? (
        <p className={s.empty}>No payments yet.</p>
      ) : (
        <div className={`${s.card} ${s.tableWrap}`}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Throne</th>
                <th>Name</th>
                <th className={s.num}>Amount</th>
                <th className={s.num}>Fee</th>
                <th className={s.num}>Refunded</th>
                <th>Status</th>
                <th>Refund</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ payment: p, throne, name, reignId }) => (
                <tr key={p.id}>
                  <td className={s.small}>{utc(p.createdAt)}</td>
                  <td>{throne}</td>
                  <td>
                    {name ?? "—"} <span className={s.mono}>{shortId(reignId)}</span>
                  </td>
                  <td className={s.num}>{money(p.amountCents)}</td>
                  <td className={s.num}>{money(p.feeCents)}</td>
                  <td className={s.num}>{p.refundedCents ? money(p.refundedCents) : "—"}</td>
                  <td>
                    <span className={p.disputed ? s.badgeWarn : s.badge}>{p.status}</span>
                  </td>
                  <td>
                    <RefundForm
                      paymentId={p.id}
                      remainingCents={p.amountCents - p.refundedCents}
                      current={!!reignId && current.has(reignId)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
