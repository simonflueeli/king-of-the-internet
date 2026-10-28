// OWNER: S. GET /api/admin/reports — AD-06 pending reports grouped by reign.
import { adminRoute } from "@/server/admin/route";
import { json } from "@/server/http";
import { listReportQueue } from "@/server/moderation/reports";

export const GET = adminRoute(async () => json({ queue: await listReportQueue() }));
