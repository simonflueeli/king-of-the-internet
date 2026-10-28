// OWNER: C. GET /api/thrones/{throne}/reigns?cursor= → { reigns, nextCursor } (50 per page, newest first).
import { json, withErrors } from "@/server/http";
import { throneParam } from "@/server/throne/api";
import { listReigns } from "@/server/throne/state";

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ throne: string }> }) => {
  const throne = throneParam((await ctx.params).throne);
  const cursor = new URL(req.url).searchParams.get("cursor");
  return json(await listReigns(throne, cursor || null));
});
