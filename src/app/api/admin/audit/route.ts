// OWNER: S. GET /api/admin/audit — latest audit log entries.
import { adminRoute } from "@/server/admin/route";
import { listAudit } from "@/server/admin/ops";
import { json } from "@/server/http";

export const GET = adminRoute(async () => json({ entries: await listAudit(200) }));
