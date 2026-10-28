// OWNER: S. GET /api/admin/me — the signed-in admin.
import { adminRoute } from "@/server/admin/route";
import { json } from "@/server/http";

export const GET = adminRoute(async (_req, admin) => json({ email: admin.email, role: admin.role }));
