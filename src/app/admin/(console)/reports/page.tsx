// OWNER: S. /admin/reports — AD-06 report queue with approve / remove.
import { AutoRefresh } from "@/components/admin/client";
import { ReportDecision } from "@/components/admin/forms";
import { utc } from "@/components/admin/format";
import s from "@/components/admin/admin.module.css";
import { REMOVAL_CATEGORIES, removalLabel } from "@/server/admin/ops";
import { listReportQueue } from "@/server/moderation/reports";

const categories = REMOVAL_CATEGORIES.map((c) => ({ value: c, label: removalLabel(c) }));

export default async function AdminReportsPage() {
  const queue = await listReportQueue();
  return (
    <>
      <AutoRefresh seconds={15} />
      <h1 className={s.h1}>Reports</h1>
      {queue.length === 0 ? (
        <p className={s.empty}>No pending reports.</p>
      ) : (
        <div className={s.stack}>
          {queue.map((item) => (
            <section key={item.reignId} className={s.card}>
              <div className={s.row} style={{ justifyContent: "space-between" }}>
                <strong>{item.name}</strong>
                <div className={s.row} style={{ gap: 4 }}>
                  <span className={s.badge}>{item.throne}</span>
                  {item.current ? <span className={s.badgeGold}>current</span> : <span className={s.badge}>{item.endReason ?? "ended"}</span>}
                  {item.blurred && <span className={s.badgeWarn}>blurred</span>}
                  {item.hidden && <span className={s.badgeWarn}>hidden</span>}
                </div>
              </div>
              {item.proclamation && <p style={{ margin: "6px 0", overflowWrap: "anywhere" }}>“{item.proclamation}”</p>}
              <p className={`${s.muted} ${s.small}`} style={{ margin: "6px 0" }}>
                {item.count} report{item.count === 1 ? "" : "s"} from {item.distinctIps} IP{item.distinctIps === 1 ? "" : "s"} ·{" "}
                {Object.entries(item.reasons)
                  .map(([r, n]) => `${r} ×${n}`)
                  .join(", ")}{" "}
                · first {utc(item.firstAt)} · last {utc(item.lastAt)}
              </p>
              {item.details.length > 0 && (
                <ul className={s.small} style={{ margin: "0 0 10px", paddingLeft: 18 }}>
                  {item.details.map((d, i) => (
                    <li key={i} style={{ overflowWrap: "anywhere" }}>
                      {d}
                    </li>
                  ))}
                </ul>
              )}
              <ReportDecision reignId={item.reignId} current={item.current} categories={categories} />
            </section>
          ))}
        </div>
      )}
    </>
  );
}
