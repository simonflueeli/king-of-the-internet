// OWNER: C. GET /api/thrones/{throne} → ThroneState.
import { json, withErrors } from "@/server/http";
import { throneParam } from "@/server/throne/api";
import { getThroneState } from "@/server/throne/state";

export const GET = withErrors(async (_req: Request, ctx: { params: Promise<{ throne: string }> }) => {
  const throne = throneParam((await ctx.params).throne);
  return json(await getThroneState(throne));
});
