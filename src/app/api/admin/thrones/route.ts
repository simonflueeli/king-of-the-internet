// OWNER: S. GET /api/admin/thrones — AD-01 live view of both thrones.
import { adminRoute } from "@/server/admin/route";
import { getAdminLiveView } from "@/server/admin/ops";
import { json } from "@/server/http";

export const GET = adminRoute(async () => json({ thrones: await getAdminLiveView() }));
