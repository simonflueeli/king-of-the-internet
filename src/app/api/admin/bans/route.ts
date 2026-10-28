// OWNER: S. GET /api/admin/bans?all=1, POST body { kind, value, reason?, expiresAt? | expiresInDays? } — AD-05.
import { adminRoute } from "@/server/admin/route";
import { createBan, isBanKind, listBans } from "@/server/bans";
import { now } from "@/server/clock";
import { HttpError, json, readJson } from "@/server/http";

export const GET = adminRoute(async (req) => {
  const all = new URL(req.url).searchParams.get("all") === "1";
  return json({ bans: await listBans({ includeExpired: all }) });
});

export const POST = adminRoute(async (req, admin) => {
  const body = await readJson<{
    kind?: unknown;
    value?: unknown;
    reason?: unknown;
    expiresAt?: unknown;
    expiresInDays?: unknown;
  }>(req);
  if (!isBanKind(body?.kind)) throw new HttpError(422, "validation", "Choose what to ban.");
  if (typeof body.value !== "string" || !body.value.trim() || body.value.length > 320) {
    throw new HttpError(422, "validation", "Enter the value to ban.");
  }
  let expiresAt: Date | null = null;
  if (typeof body.expiresInDays === "number" && body.expiresInDays > 0) {
    expiresAt = new Date(now().getTime() + body.expiresInDays * 86_400_000);
  } else if (typeof body.expiresAt === "string" && body.expiresAt) {
    expiresAt = new Date(body.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now()) {
      throw new HttpError(422, "validation", "The expiry must be in the future.");
    }
  }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) || null : null;
  const ban = await createBan({ kind: body.kind, value: body.value, reason, expiresAt, actor: admin.email });
  return json({ ban }, 201);
});
