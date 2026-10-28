// OWNER: S. GET /api/admin/revenue?days=30 — AD-09 per day and throne.
import { adminRoute } from "@/server/admin/route";
import { revenueByDay } from "@/server/admin/ops";
import { json } from "@/server/http";

export const GET = adminRoute(async (req) => {
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 30));
  return json({ days, rows: await revenueByDay(days) });
});
