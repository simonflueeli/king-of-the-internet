// OWNER: S. /admin/terms — AD-08 banned terms (case and accent insensitive, whole words).
import { ActionButton } from "@/components/admin/client";
import { TermForm } from "@/components/admin/forms";
import { utc } from "@/components/admin/format";
import s from "@/components/admin/admin.module.css";
import { listBannedTerms } from "@/server/moderation/terms";

export default async function AdminTermsPage() {
  const terms = await listBannedTerms();
  return (
    <>
      <h1 className={s.h1}>Banned terms</h1>
      <div className={s.stack}>
        <section className={s.card}>
          <TermForm />
          <p className={`${s.muted} ${s.small}`}>
            Matched on whole words, ignoring case, accents, look-alike letters, spacing (“s l u r”) and digit swaps
            (“5lur”). Changes apply within 30 seconds.
          </p>
        </section>
        <section className={s.card}>
          {terms.length === 0 ? (
            <p className={s.empty}>The list is empty.</p>
          ) : (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Term</th>
                    <th className={s.hideSm}>Added by</th>
                    <th className={s.hideSm}>Added</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {terms.map((t) => (
                    <tr key={t.id}>
                      <td className={s.mono}>{t.term}</td>
                      <td className={`${s.hideSm} ${s.small}`}>{t.createdBy}</td>
                      <td className={`${s.hideSm} ${s.small}`}>{utc(t.createdAt)}</td>
                      <td>
                        <ActionButton path={`/api/admin/banned-terms/${t.id}`} method="DELETE" label="Remove" />
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
