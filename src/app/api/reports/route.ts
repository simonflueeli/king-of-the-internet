// OWNER: S. POST /api/reports — a viewer flags a reign's name or proclamation (FR-07).
import { copy } from "@/lib/copy";
import { hashIp } from "@/server/hash";
import { assertOrigin, clientIp, HttpError, json, readJson, withErrors } from "@/server/http";
import { submitReport } from "@/server/moderation/reports";

export const runtime = "nodejs";

export const POST = withErrors(async (req: Request) => {
  assertOrigin(req);
  const body = await readJson<{ reignId?: unknown; reason?: unknown; details?: unknown }>(req);
  const result = await submitReport({
    reignId: body?.reignId,
    reason: body?.reason,
    details: body?.details,
    ipHash: hashIp(clientIp(req)),
  });
  if (!result.ok) {
    if (result.error === "rate_limited") throw new HttpError(429, "rate_limited", copy.safety.reports.rateLimited);
    if (result.error === "not_found") throw new HttpError(404, "not_found", copy.safety.reports.notFound);
    throw new HttpError(422, "validation", copy.safety.reports.invalid);
  }
  return json({ ok: true, message: copy.safety.reports.received }, 201);
});
