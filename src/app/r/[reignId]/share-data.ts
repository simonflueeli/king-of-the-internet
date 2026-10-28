// OWNER: G. Data for the public reign page and its OG image (FR-70, FR-71, FR-73).
import { cache } from "react";
import type { ReignDTO, ThroneId } from "@/lib/contracts";
import { nextUtcMidnight } from "@/lib/pricing";
import { now } from "@/server/clock";
import { getReign, utcDayStart } from "@/server/throne/state";

/** End reasons after which a reign is no longer shown publicly (removed by an admin or refunded). */
const WITHDRAWN: ReadonlySet<string> = new Set(["removed", "refunded", "disputed"]);

export type ShareData =
  | { kind: "hidden"; throne: ThroneId }
  | {
      kind: "shown";
      reign: ReignDTO;
      /** Still on the throne. */
      live: boolean;
      /** Reign length so far (live) or in total (ended). */
      lengthMs: number;
      /** Proclamation to display: null when empty or blurred because of pending reports. */
      proclamation: string | null;
    };

export const loadShare = cache(async (reignId: string): Promise<ShareData | null> => {
  const reign = await getReign(reignId);
  if (!reign) return null;
  if (reign.hidden || (reign.endReason && WITHDRAWN.has(reign.endReason))) return { kind: "hidden", throne: reign.throne };

  const t = now();
  const started = new Date(reign.startedAt);
  let live = reign.endedAt === null;
  let lengthMs = reign.lengthMs;
  // A daily king from before today's reset has lost the seat even if the reset job has not run yet.
  if (live && reign.throne === "daily" && started < utcDayStart(t)) {
    live = false;
    lengthMs = nextUtcMidnight(started).getTime() - started.getTime();
  }
  return {
    kind: "shown",
    reign,
    live,
    lengthMs,
    proclamation: reign.proclamationBlurred ? null : reign.proclamation,
  };
});
