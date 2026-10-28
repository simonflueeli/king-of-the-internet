// OWNER: S. GET /api/admin/config, PATCH body { <key>: number, … } — AD-07.
import { adminRoute } from "@/server/admin/route";
import { adminUpdateConfig } from "@/server/admin/ops";
import { getConfig } from "@/server/config";
import { json, readJson } from "@/server/http";

export const GET = adminRoute(async () => json({ config: await getConfig() }));

export const PATCH = adminRoute(async (req, admin) => {
  const body = await readJson<Record<string, unknown>>(req);
  return json({ config: await adminUpdateConfig(body, admin) });
});
