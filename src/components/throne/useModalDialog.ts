// OWNER: U. Opens a native <dialog> as a modal on mount (the browser makes the rest of the page inert, which
// traps focus), routes Escape through `onEscape`, and returns focus to the opener on unmount (AC-21).
import { useEffect, useRef, type RefObject } from "react";

export function useModalDialog(onEscape: () => void, returnFocusTo?: RefObject<HTMLElement | null>): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement | null>(null);
  const escRef = useRef(onEscape);
  useEffect(() => {
    escRef.current = onEscape;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = (returnFocusTo?.current ?? document.activeElement) as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      escRef.current();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      // The opener (the CTA) is disabled while the sheet is open; it re-enables on the next render.
      setTimeout(() => {
        if (opener && opener.isConnected && !opener.hasAttribute("disabled")) opener.focus();
        else (document.getElementById("tryInput") as HTMLElement | null)?.focus();
      }, 0);
    };
  }, [returnFocusTo]);

  return ref;
}
