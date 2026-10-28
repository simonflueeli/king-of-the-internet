// OWNER: S. /admin/config — AD-07 config editor with next-minimum preview.
import { eq } from "drizzle-orm";
import { ConfigEditor, type ThronePricingSnapshot } from "@/components/admin/ConfigEditor";
import s from "@/components/admin/admin.module.css";
import { EDITABLE_CONFIG_KEYS } from "@/server/admin/ops";
import { now } from "@/server/clock";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { thrones } from "@/server/db/schema";
import { THRONE_IDS } from "@/server/throne/state";

export default async function AdminConfigPage() {
  const cfg = await getConfig();
  const db = await getDb();
  const serverNow = now().toISOString();
  const snapshots: ThronePricingSnapshot[] = await Promise.all(
    THRONE_IDS.map(async (throne) => {
      const [row] = await db.select().from(thrones).where(eq(thrones.id, throne));
      return {
        throne,
        lastPaidCents: row?.lastPaidCents ?? null,
        crownedAt: row?.crownedAt?.toISOString() ?? null,
        serverNow,
      };
    }),
  );
  const values = Object.fromEntries(EDITABLE_CONFIG_KEYS.map((k) => [k, cfg[k] as number]));
  return (
    <>
      <h1 className={s.h1}>Configuration</h1>
      <ConfigEditor config={values} keys={[...EDITABLE_CONFIG_KEYS]} thrones={snapshots} />
    </>
  );
}
