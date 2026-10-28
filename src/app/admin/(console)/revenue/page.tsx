// OWNER: S. /admin/revenue — AD-09 takeovers, gross, fees, refunds and disputes per day and throne.
import { money } from "@/components/admin/format";
import s from "@/components/admin/admin.module.css";
import { revenueByDay } from "@/server/admin/ops";

export default async function AdminRevenuePage() {
  const rows = await revenueByDay(30);
  const total = rows.reduce(
    (a, r) => ({
      takeovers: a.takeovers + r.takeovers,
      gross: a.gross + r.grossCents,
      fees: a.fees + r.feeCents,
      refunds: a.refunds + r.refundedCents,
      disputes: a.disputes + r.disputes,
    }),
    { takeovers: 0, gross: 0, fees: 0, refunds: 0, disputes: 0 },
  );
  return (
    <>
      <h1 className={s.h1}>Revenue (last 30 days, UTC)</h1>
      <div className={`${s.card} ${s.tableWrap}`}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Day</th>
              <th>Throne</th>
              <th className={s.num}>Takeovers</th>
              <th className={s.num}>Gross</th>
              <th className={s.num}>Fees</th>
              <th className={s.num}>Refunds</th>
              <th className={s.num}>Disputes</th>
              <th className={s.num}>Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className={s.empty}>
                  No payments in this period.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.day}-${r.throne}`}>
                <td>{r.day}</td>
                <td>{r.throne}</td>
                <td className={s.num}>{r.takeovers}</td>
                <td className={s.num}>{money(r.grossCents)}</td>
                <td className={s.num}>{money(r.feeCents)}</td>
                <td className={s.num}>{money(r.refundedCents)}</td>
                <td className={s.num}>{r.disputes}</td>
                <td className={s.num}>{money(r.grossCents - r.feeCents - r.refundedCents)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <th colSpan={2}>Total</th>
                <th className={s.num}>{total.takeovers}</th>
                <th className={s.num}>{money(total.gross)}</th>
                <th className={s.num}>{money(total.fees)}</th>
                <th className={s.num}>{money(total.refunds)}</th>
                <th className={s.num}>
                  {total.disputes}
                  {total.takeovers > 0 && ` (${((total.disputes / total.takeovers) * 100).toFixed(2)}%)`}
                </th>
                <th className={s.num}>{money(total.gross - total.fees - total.refunds)}</th>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
