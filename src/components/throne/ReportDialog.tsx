// OWNER: U. "Report" form for the current king's name or proclamation (FR-07) → POST /api/reports.
"use client";
import { useState } from "react";
import { getApi, type ReportReason } from "@/lib/api-client";
import { copy, fill } from "@/lib/copy";
import s from "./throne.module.css";
import { useModalDialog } from "./useModalDialog";

const ui = copy.ui;
const REASONS: ReportReason[] = ["offensive", "impersonation", "spam", "other"];

export function ReportDialog({ reignId, name, onClose }: { reignId: string; name: string; onClose: () => void }) {
  const ref = useModalDialog(onClose);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [phase, setPhase] = useState<"form" | "sending" | "sent">("form");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason || phase !== "form") return;
    setPhase("sending");
    setError(null);
    const api = await getApi();
    const res = await api.report({ reignId, reason, details: details.trim() || undefined });
    if (res.ok) {
      setPhase("sent");
      return;
    }
    setPhase("form");
    setError(res.status === 429 ? ui.reportRateLimited : res.status === 0 ? ui.errNetwork : copy.errGeneric);
  }

  return (
    <dialog ref={ref} className={s.dialog} aria-labelledby="reportTitle">
      <div className={s.dialogBody}>
        <h2 id="reportTitle">{ui.reportHeading}</h2>
        {phase === "sent" ? (
          <>
            <p role="status">{ui.reportThanks}</p>
            <div className={s.dialogActions}>
              <button type="button" className={s.btnSecondary} onClick={onClose} autoFocus>
                {ui.reportClose}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <p>{fill(ui.reportIntro, { name })}</p>
            <fieldset>
              <legend>{ui.reportReasonLegend}</legend>
              {REASONS.map((r, i) => (
                <label key={r} className={s.radio}>
                  <input
                    type="radio"
                    name="reason"
                    value={r}
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    required
                    autoFocus={i === 0}
                  />
                  {ui.reportReasons[r]}
                </label>
              ))}
            </fieldset>
            <label className={s.fieldLabel} htmlFor="reportDetails">
              {ui.reportDetails}
            </label>
            <textarea id="reportDetails" rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
            {error && (
              <p className={s.formError} role="alert">
                {error}
              </p>
            )}
            <div className={s.dialogActions}>
              <button type="submit" className={s.btnPrimary} disabled={!reason || phase === "sending"}>
                {phase === "sending" ? ui.reportSending : ui.reportSubmit}
              </button>
              <button type="button" className={s.btnSecondary} onClick={onClose}>
                {ui.reportCancel}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
