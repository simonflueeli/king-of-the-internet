// OWNER: F (C fills registerJobs). Called once per server instance before it handles requests.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Never start timers (or open the database) while `next build` prerenders pages.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.JOBS_INPROCESS === "0") return;
  await registerJobs();
}

/**
 * C: start the in-process job timers here (expire every 10 s, reconcile every minute, daily reset at
 * 00:00 UTC, retention daily), calling the pure job functions from src/server/throne/jobs.ts via a
 * dynamic import so the Edge bundle never sees server modules. Guard against double registration
 * in dev hot reloads with a globalThis flag.
 */
async function registerJobs(): Promise<void> {
  // no-op until C implements the jobs
}
