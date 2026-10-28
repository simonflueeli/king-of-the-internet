// OWNER: C. GET /api/cron/{expire|reconcile|daily-reset|retention} with Authorization: Bearer $CRON_SECRET.
import { copy } from "@/lib/copy";
import { safeEqual } from "@/server/hash";
import { HttpError, json, withErrors } from "@/server/http";
import { isJobName, runJob } from "@/server/throne/jobs";

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ job: string }> }) => {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !safeEqual(given, secret)) throw new HttpError(401, "unauthorized", copy.core.errUnauthorized);
  const { job } = await ctx.params;
  if (!isJobName(job)) throw new HttpError(404, "not_found", copy.core.errNotFound);
  return json(await runJob(job));
});
