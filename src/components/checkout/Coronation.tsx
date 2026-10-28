// OWNER: U. Coronation screen after a successful takeover (PRD "Coronation screen"), plus the confetti burst.
"use client";
import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { copy, fill } from "@/lib/copy";
import type { Title } from "@/lib/contracts";
import { Crest } from "@/components/throne/Crest";
import s from "./checkout.module.css";

const ui = copy.ui;
const COLORS = ["#F6D77A", "#E2B04A", "#FFF3C4", "#B8304A", "#F4F2EA"];

/** About 80 gold, cream and crimson pieces falling 1.7–3.2 s; nothing with reduced motion. */
export function Confetti() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const layer = ref.current;
    if (!layer || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const height = layer.clientHeight || 500;
    const pieces: HTMLSpanElement[] = [];
    for (let i = 0; i < 80; i++) {
      const p = document.createElement("span");
      if (typeof p.animate !== "function") return;
      const w = 6 + Math.random() * 6;
      p.className = s.confetto;
      p.style.cssText = `left:${Math.random() * 100}%;width:${w}px;height:${w * 0.45}px;background:${COLORS[i % COLORS.length]};`;
      layer.append(p);
      pieces.push(p);
      const dx = (Math.random() - 0.5) * 180;
      const rot = Math.random() * 900 - 450;
      const a = p.animate(
        [
          { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
          { transform: `translate(${dx}px, ${height + 40}px) rotate(${rot}deg)`, opacity: 0.85 },
        ],
        { duration: 1700 + Math.random() * 1500, delay: Math.random() * 450, easing: "cubic-bezier(.2,.6,.4,1)", fill: "forwards" },
      );
      a.onfinish = () => p.remove();
    }
    return () => pieces.forEach((p) => p.remove());
  }, []);
  return <div ref={ref} className={s.confetti} aria-hidden="true" />;
}

export function Coronation(props: {
  title: Title;
  name: string;
  paid: string;
  next: string;
  throneLabel: string;
  reignUrl: string;
  onClose: () => void;
}) {
  const { title, name, reignUrl } = props;
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [canShare] = useState(() => typeof navigator !== "undefined" && typeof navigator.share === "function");
  const brag = fill(ui.coronationBrag, { title, name, price: props.paid });

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  async function share() {
    track("share_clicked", { method: "native" });
    try {
      await navigator.share({ title: ui.coronationShareTitle, text: brag, url: reignUrl });
    } catch {
      // dismissed
    }
  }

  async function copyLink() {
    track("share_clicked", { method: "copy" });
    try {
      await navigator.clipboard.writeText(`${brag} ${reignUrl}`);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  }

  return (
    <div className={`${s.sheet} ${s.done}`}>
      <Confetti />
      <Crest name={name} idPrefix="done" className={s.crestXl} />
      <p className={s.hail}>{ui.coronationKicker}</p>
      <h2 className={s.doneName} id="doneTitle">
        {fill(copy.hallName, { title, name })}
      </h2>
      <p className={s.doneText}>{fill(ui.coronationPaid, { price: props.paid, throneLabel: props.throneLabel, next: props.next })}</p>
      <div className={s.brag}>
        <p>{brag}</p>
        <a className={s.reignLink} href={reignUrl}>
          {reignUrl}
        </a>
        <div className={s.bragButtons}>
          {canShare && (
            <button type="button" onClick={share}>
              {ui.coronationShare}
            </button>
          )}
          <button type="button" onClick={copyLink}>
            {copied === "ok" ? ui.coronationCopied : ui.coronationCopy}
          </button>
        </div>
        {copied === "fail" && (
          <p role="status" style={{ margin: ".5rem 0 0", fontStyle: "normal" }}>
            {ui.coronationCopyFailed}
          </p>
        )}
      </div>
      <div className={s.actions}>
        <button ref={closeRef} type="button" className={s.payBtn} onClick={props.onClose}>
          {ui.coClose}
        </button>
      </div>
    </div>
  );
}
