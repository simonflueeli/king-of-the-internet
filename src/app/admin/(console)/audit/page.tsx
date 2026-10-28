// OWNER: S. /admin/audit — the latest audit log entries (append only).
import { utc } from "@/components/admin/format";
import s from "@/components/admin/admin.module.css";
import { listAudit } from "@/server/admin/ops";

const short = (v: unknown) => (v == null ? "" : JSON.stringify(v));

export default async function AdminAuditPage() {
  const entries = await listAudit(200);
  return (
    <>
      <h1 className={s.h1}>Audit log</h1>
      <div className={`${s.card} ${s.tableWrap}`}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th className={s.hideSm}>Change</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className={s.small} style={{ whiteSpace: "nowrap" }}>
                  {utc(e.createdAt)}
                </td>
                <td className={s.small}>{e.actor}</td>
                <td>{e.action}</td>
                <td className={s.mono}>{e.target ?? ""}</td>
                <td className={`${s.hideSm} ${s.mono}`}>
                  {short(e.before)}
                  {e.before != null && e.after != null ? " → " : ""}
                  {short(e.after)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
