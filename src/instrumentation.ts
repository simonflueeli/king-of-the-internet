// OWNER: F (C fills job registration). Called once per server instance before it handles requests.

export async function register() {
  // Never start timers (or open the database) while `next build` prerenders pages.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.JOBS_INPROCESS === "0") return;
  // In-process job timers: expire every 10 s, reconcile every minute, daily reset at 00:00 UTC,
  // retention daily (src/server/throne/jobs.ts). The import sits directly under the literal
  // NEXT_RUNTIME check so the Edge bundle drops it; startJobTimers() guards against double
  // registration in dev hot reloads.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobTimers } = await import("./server/throne/jobs");
    startJobTimers();
  }
}
