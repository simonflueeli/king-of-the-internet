// OWNER: S. /admin — AD-01 live view of both thrones, AD-02 remove king, AD-03 hide reign,
// AD-04 refund (per reign row).
import { ActionButton, AutoRefresh } from "@/components/admin/client";
import { RefundForm, RemoveKingForm } from "@/components/admin/forms";
import { duration, money, shortId, utc } from "@/components/admin/format";
import s from "@/components/admin/admin.module.css";
import { copy } from "@/lib/copy";
import { getAdminLiveView, REMOVAL_CATEGORIES, removalLabel, type AdminThroneView } from "@/server/admin/ops";

const categories = REMOVAL_CATEGORIES.map((c) => ({ value: c, label: removalLabel(c) }));

export default async function AdminThronesPage() {
  const views = await getAdminLiveView();
  return (
    <>
      <AutoRefresh seconds={5} />
      <h1 className={s.h1}>Thrones</h1>
      <div className={s.grid2}>
        {views.map((v) => (
          <ThroneCard key={v.state.throne} view={v} />
        ))}
      </div>
    </>
  );
}

function ThroneCard({ view }: { view: AdminThroneView }) {
  const { state, openReservation: r } = view;
  const king = state.king;
  const kingRow = view.reigns.find((x) => x.current);
  return (
    <section className={s.card} aria-labelledby={`t-${state.throne}`}>
      <div className={s.row} style={{ justifyContent: "space-between" }}>
        <h2 id={`t-${state.throne}`} className={s.h2} style={{ margin: 0 }}>
          {copy.throneName[state.throne]}
        </h2>
        <span className={s.muted}>
          v{state.version} · {state.watching} watching
        </span>
      </div>

      <h3 className={s.h3}>Current king</h3>
      {king ? (
        <div className={s.stack} style={{ gap: 10 }}>
          <div>
            <div className={s.king}>
              {king.title} {king.name}{" "}
              {king.proclamationBlurred && <span className={s.badgeWarn}>blurred</span>}{" "}
              {kingRow?.hidden && <span className={s.badgeWarn}>hidden</span>}
            </div>
            {king.proclamation && <p style={{ margin: "4px 0 0" }}>“{king.proclamation}”</p>}
            <p className={`${s.muted} ${s.small}`} style={{ margin: "4px 0 0" }}>
              Paid {money(king.paidCents)} · reigning {duration(king.lengthMs)} · since {utc(king.crownedAt)} ·{" "}
              <span className={s.mono}>{shortId(king.id)}</span>
            </p>
          </div>
          <RemoveKingForm throne={state.throne} reignId={king.id} name={king.name} categories={categories} />
        </div>
      ) : (
        <p className={s.empty}>Vacant ({state.vacancy?.reason ?? "unknown"})</p>
      )}

      <h3 className={s.h3}>Price</h3>
      <dl className={s.kv}>
        <dt>Minimum</dt>
        <dd>{money(state.minCents)}</dd>
        <dt>Next at minimum</dt>
        <dd>{money(state.nextMinCentsAtMinimum)}</dd>
        {state.throne === "eternal" ? (
          <>
            <dt>Idle days</dt>
            <dd>{state.idleDays}</dd>
          </>
        ) : (
          <>
            <dt>Resets</dt>
            <dd>{utc(state.resetsAt)}</dd>
          </>
        )}
        <dt>{state.throne === "daily" ? "Today" : "All time"}</dt>
        <dd>
          {state.stats.reignCount} reigns · {money(state.stats.totalPaidCents)}
        </dd>
      </dl>

      <h3 className={s.h3}>Reservation</h3>
      {r ? (
        <dl className={s.kv}>
          <dt>State</dt>
          <dd>
            <span className={r.state === "paying" ? s.badgeGold : s.badge}>{r.state}</span> ({r.source})
          </dd>
          <dt>Locked until</dt>
          <dd>{utc(r.expiresAt)}</dd>
          <dt>Minimum / amount</dt>
          <dd>
            {money(r.minCents)} / {money(r.amountCents)}
          </dd>
          <dt>Last heartbeat</dt>
          <dd>{utc(r.lastHeartbeatAt)}</dd>
          {r.name && (
            <>
              <dt>Name</dt>
              <dd>{r.name}</dd>
            </>
          )}
          <dt>Id</dt>
          <dd className={s.mono}>{r.id}</dd>
        </dl>
      ) : (
        <p className={s.empty}>No open reservation.</p>
      )}

      <h3 className={s.h3}>Recent reigns</h3>
      {view.reigns.length === 0 ? (
        <p className={s.empty}>No reigns yet.</p>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Reign</th>
                <th className={s.num}>Paid</th>
                <th className={s.hideSm}>Started</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {view.reigns.map((reign) => {
                const p = reign.payment;
                return (
                  <tr key={reign.id}>
                    <td>
                      <strong>
                        {reign.title} {reign.name}
                      </strong>
                      {reign.proclamation && (
                        <div className={`${s.muted} ${s.small}`} style={{ overflowWrap: "anywhere" }}>
                          {reign.proclamation}
                        </div>
                      )}
                    </td>
                    <td className={s.num}>
                      {money(reign.paidCents)}
                      {p && p.refundedCents > 0 && <div className={s.small}>−{money(p.refundedCents)}</div>}
                    </td>
                    <td className={`${s.hideSm} ${s.small}`}>{utc(reign.startedAt)}</td>
                    <td>
                      <div className={s.row} style={{ gap: 4 }}>
                        {reign.current ? (
                          <span className={s.badgeGold}>current</span>
                        ) : (
                          <span className={s.badge}>{reign.endReason ?? "ended"}</span>
                        )}
                        {reign.hidden && <span className={s.badgeWarn}>hidden</span>}
                        {reign.blurred && <span className={s.badgeWarn}>blurred</span>}
                        {p?.disputed && <span className={s.badgeWarn}>disputed</span>}
                      </div>
                    </td>
                    <td>
                      <div className={s.stack} style={{ gap: 6 }}>
                        <ActionButton
                          path={`/api/admin/reigns/${reign.id}/hidden`}
                          body={{ hidden: !reign.hidden }}
                          label={reign.hidden ? "Unhide" : "Hide"}
                          confirm={reign.hidden ? undefined : `Hide ${reign.name} from the hall of kings and its share page?`}
                        />
                        {p && (
                          <RefundForm
                            paymentId={p.id}
                            remainingCents={p.amountCents - p.refundedCents}
                            current={reign.current}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
