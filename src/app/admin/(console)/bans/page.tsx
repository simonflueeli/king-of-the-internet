// OWNER: S. /admin/bans — AD-05 bans by email, card fingerprint, IP or device id, with expiry.
import { ActionButton } from "@/components/admin/client";
import { BanForm } from "@/components/admin/forms";
import { utc } from "@/components/admin/format";
import s from "@/components/admin/admin.module.css";
import { listBans } from "@/server/bans";

export default async function AdminBansPage() {
  const bans = await listBans();
  return (
    <>
      <h1 className={s.h1}>Bans</h1>
      <div className={s.stack}>
        <section className={s.card}>
          <h2 className={s.h2}>New ban</h2>
          <BanForm />
        </section>
        <section className={s.card}>
          <h2 className={s.h2}>Active bans</h2>
          {bans.length === 0 ? (
            <p className={s.empty}>No active bans.</p>
          ) : (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Reason</th>
                    <th>Expires</th>
                    <th className={s.hideSm}>By</th>
                    <th className={s.hideSm}>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {bans.map((b) => (
                    <tr key={b.id}>
                      <td>{b.kind}</td>
                      <td style={{ overflowWrap: "anywhere" }}>{b.reason ?? "—"}</td>
                      <td className={s.small}>{b.expiresAt ? utc(b.expiresAt) : "never"}</td>
                      <td className={`${s.hideSm} ${s.small}`}>{b.createdBy}</td>
                      <td className={`${s.hideSm} ${s.small}`}>{utc(b.createdAt)}</td>
                      <td>
                        <ActionButton path={`/api/admin/bans/${b.id}`} method="DELETE" label="Lift" confirm="Lift this ban now?" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
