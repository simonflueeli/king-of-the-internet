// OWNER: U. Dev-only floating panel that drives the in-browser API mock (src/lib/api-mock.ts): rival buyers,
// live takeovers, removals, the daily reset and error responses. Rendered only when `?mock=` is active.
"use client";
import { useEffect, useState } from "react";
import { getApi } from "@/lib/api-client";
import type { MockApi } from "@/lib/api-mock";
import type { ThroneId } from "@/lib/contracts";

const panel: React.CSSProperties = {
  position: "fixed",
  right: 8,
  bottom: 8,
  zIndex: 50,
  maxWidth: "calc(100vw - 16px)",
  font: "600 12px/1.3 system-ui, sans-serif",
  background: "rgba(10, 13, 40, .92)",
  color: "#fff",
  border: "1px dashed #E2B04A",
  borderRadius: 10,
  padding: 8,
};
const btn: React.CSSProperties = {
  font: "inherit",
  margin: 2,
  padding: "4px 7px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,.3)",
  background: "transparent",
  color: "#fff",
  cursor: "pointer",
};

export default function MockPanel({ throne }: { throne: ThroneId }) {
  const [api, setApi] = useState<MockApi | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void getApi().then((a) => {
      if ("controls" in a) setApi(a as MockApi);
    });
  }, []);
  if (!api) return null;
  const c = api.controls;
  const actions: [string, () => void][] = [
    ["Rival opens checkout", () => c.rivalCheckout(throne)],
    ["Rival leaves", () => c.rivalRelease(throne)],
    ["Rival takes throne", () => c.rivalTakeover(throne)],
    ["Remove king", () => c.removeKing(throne)],
    ["Daily reset", () => c.dailyReset()],
    ["Next reserve → 409", () => c.failNextReservation("busy")],
    ["Next reserve → 429", () => c.failNextReservation("rate_limited")],
    ["Reset (demo)", () => c.reset("1")],
    ["Reset (empty)", () => c.reset("empty")],
  ];
  return (
    <aside style={panel} aria-label="Mock API controls">
      <button type="button" style={{ ...btn, borderColor: "#E2B04A" }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Mock API ({api.scenario}) {open ? "▾" : "▸"}
      </button>
      {open && (
        <div style={{ display: "flex", flexWrap: "wrap", maxWidth: 340, marginTop: 4 }}>
          {actions.map(([label, fn]) => (
            <button key={label} type="button" style={btn} onClick={fn}>
              {label}
            </button>
          ))}
          <p style={{ margin: "4px 2px 0", fontWeight: 400, opacity: 0.8 }}>
            Names with a link → moderation 422; “#503” → moderation unavailable. Add ?mock=0 to leave.
          </p>
        </div>
      )}
    </aside>
  );
}
