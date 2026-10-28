// OWNER: G. Stub shipped by F: logs only. G sends receipt / overthrow / removal / refund emails.
// Callers fire and forget; these functions must never throw into the caller.
import type { ThroneId } from "@/lib/contracts";

/** C calls this after the crown transaction commits. */
export async function onTakeoverCommitted(e: {
  throne: ThroneId;
  reignId: string;
  previousReignId: string | null;
}): Promise<void> {
  console.info("[notifications] stub: takeover committed", e);
}

/** S calls this after an admin removal when "notify king" is chosen. */
export async function onKingRemoved(e: { reignId: string; reasonCategory: string; notify: boolean }): Promise<void> {
  console.info("[notifications] stub: king removed", e);
}

export async function onRefundIssued(e: { reignId: string; amountCents: number }): Promise<void> {
  console.info("[notifications] stub: refund issued", e);
}
