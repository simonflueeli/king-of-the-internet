// OWNER: S. GET /api/admin/payments — recent payments.
import { adminRoute } from "@/server/admin/route";
import { listPayments } from "@/server/admin/ops";
import { json } from "@/server/http";

export const GET = adminRoute(async () => json({ payments: await listPayments(100) }));
