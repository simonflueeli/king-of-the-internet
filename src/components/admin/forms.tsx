"use client";
// OWNER: S. Admin console forms: remove king (AD-02), refund (AD-04), ban (AD-05), report decision
// (AD-06), banned term (AD-08).
import { useState } from "react";
import { copy, fill } from "@/lib/copy";
import { formatMoney } from "@/lib/format";
import { useAdminAction } from "./client";
import s from "./admin.module.css";

const t = copy.safety.admin;
const money = (cents: number) => formatMoney(cents, { locale: "en-GB" });

export type CategoryOption = { value: string; label: string };

export function RemoveKingForm(props: {
  throne: "eternal" | "daily";
  reignId: string;
  name: string;
  categories: CategoryOption[];
}) {
  const { run, busy, error } = useAdminAction();
  const [category, setCategory] = useState("");
  const [notify, setNotify] = useState(false);
  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (!window.confirm(fill(t.confirmRemove, { name: props.name, throne: copy.throneLabel[props.throne] }))) return;
        void run(`/api/admin/thrones/${props.throne}/remove`, "POST", {
          reignId: props.reignId,
          reasonCategory: category,
          notify,
        });
      }}
    >
      <div className={s.row}>
        <label className={s.label} style={{ flex: "1 1 180px" }}>
          Reason category
          <select className={s.select} required value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="" disabled>
              Choose…
            </option>
            {props.categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={s.checkbox} style={{ alignSelf: "end", paddingBottom: 8 }}>
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the king
        </label>
        <button type="submit" className={s.danger} disabled={busy || !category} style={{ alignSelf: "end" }}>
          Remove king
        </button>
      </div>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
    </form>
  );
}

export function RefundForm(props: { paymentId: string; remainingCents: number; current: boolean }) {
  const { run, busy, error } = useAdminAction();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((props.remainingCents / 100).toFixed(2));
  if (props.remainingCents <= 0) return <span className={s.muted}>Refunded</span>;
  if (!open) {
    return (
      <button type="button" className={s.button} onClick={() => setOpen(true)}>
        Refund…
      </button>
    );
  }
  const cents = Math.round(Number(amount.replace(",", ".")) * 100);
  const valid = Number.isInteger(cents) && cents >= 1 && cents <= props.remainingCents;
  return (
    <form
      className={s.row}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const msg = fill(t.confirmRefund, { amount: money(cents) });
        if (!window.confirm(props.current ? msg : msg.replace(/ If this.*$/, ""))) return;
        void run(`/api/admin/payments/${props.paymentId}/refund`, "POST", {
          amountCents: cents === props.remainingCents ? undefined : cents,
          confirm: true,
        }).then((r) => r && setOpen(false));
      }}
    >
      <label className={s.label}>
        Amount (max {money(props.remainingCents)})
        <input
          className={s.input}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={!valid}
          style={{ width: 110 }}
        />
      </label>
      <button type="submit" className={s.danger} disabled={busy || !valid} style={{ alignSelf: "end" }}>
        Refund {valid ? money(cents) : ""}
      </button>
      <button type="button" className={s.button} onClick={() => setOpen(false)} style={{ alignSelf: "end" }}>
        Cancel
      </button>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
    </form>
  );
}

export function BanForm() {
  const { run, busy, error } = useAdminAction();
  const [kind, setKind] = useState("email");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("");
  const [done, setDone] = useState(false);
  return (
    <form
      className={s.form}
      onSubmit={async (e) => {
        e.preventDefault();
        setDone(false);
        const r = await run("/api/admin/bans", "POST", {
          kind,
          value,
          reason: reason || undefined,
          expiresInDays: days ? Number(days) : undefined,
        });
        if (r) {
          setValue("");
          setReason("");
          setDone(true);
        }
      }}
    >
      <div className={s.row}>
        <label className={s.label}>
          Type
          <select className={s.select} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="email">Email</option>
            <option value="card">Card fingerprint</option>
            <option value="ip">IP address or IP hash</option>
            <option value="device">Device id</option>
          </select>
        </label>
        <label className={s.label} style={{ flex: "1 1 220px" }}>
          Value
          <input className={s.input} required value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
      </div>
      <div className={s.row}>
        <label className={s.label} style={{ flex: "1 1 220px" }}>
          Reason
          <input className={s.input} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className={s.label}>
          Expires after
          <select className={s.select} value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="">Never</option>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
        </label>
        <button type="submit" className={s.primary} disabled={busy} style={{ alignSelf: "end" }}>
          Ban
        </button>
      </div>
      <p className={`${s.muted} ${s.small}`} style={{ margin: 0 }}>
        Values are stored only as salted hashes. A ban is checked at reservation and at payment.
      </p>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {done && <p className={s.ok}>Ban saved.</p>}
    </form>
  );
}

export function ReportDecision(props: { reignId: string; current: boolean; categories: CategoryOption[] }) {
  const { run, busy, error } = useAdminAction();
  const [category, setCategory] = useState("");
  const [notify, setNotify] = useState(false);
  return (
    <div className={s.form}>
      <div className={s.row}>
        <button
          type="button"
          className={s.button}
          disabled={busy}
          onClick={() => void run(`/api/admin/reports/${props.reignId}`, "POST", { action: "approve" })}
        >
          Approve (keep)
        </button>
        <select
          className={s.select}
          aria-label="Reason category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Reason…</option>
          {props.categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {props.current && (
          <label className={s.checkbox}>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the king
          </label>
        )}
        <button
          type="button"
          className={s.danger}
          disabled={busy || !category}
          onClick={() => {
            if (!window.confirm(props.current ? "Remove this king and hide the reign?" : "Hide this reign?")) return;
            void run(`/api/admin/reports/${props.reignId}`, "POST", { action: "remove", reasonCategory: category, notify });
          }}
        >
          Remove
        </button>
      </div>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
    </div>
  );
}

export function TermForm() {
  const { run, busy, error } = useAdminAction();
  const [term, setTerm] = useState("");
  return (
    <form
      className={s.row}
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run("/api/admin/banned-terms", "POST", { term })) setTerm("");
      }}
    >
      <label className={s.label} style={{ flex: "1 1 240px" }}>
        New term
        <input className={s.input} required maxLength={100} value={term} onChange={(e) => setTerm(e.target.value)} />
      </label>
      <button type="submit" className={s.primary} disabled={busy} style={{ alignSelf: "end" }}>
        Add
      </button>
      {error && (
        <p role="alert" className={s.error} style={{ flexBasis: "100%" }}>
          {error}
        </p>
      )}
    </form>
  );
}
