"use client";
// OWNER: G. Share the reign page: native share sheet where available, otherwise copy the link.
import { useState } from "react";
import { track } from "@/lib/analytics";
import s from "./share.module.css";

export function ShareButton({ url, title, label, copiedLabel }: { url: string; title: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        track("share_clicked", { method: "native" });
      } catch {
        // dismissed
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      track("share_clicked", { method: "copy" });
      setTimeout(() => setCopied(false), 2_500);
    } catch {
      window.prompt(title, url);
    }
  }

  return (
    <button type="button" className={s.secondary} onClick={onClick}>
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
}
