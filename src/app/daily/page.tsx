// OWNER: U. The Daily Throne (resets at 00:00 UTC).
import type { Metadata } from "next";
import { connection } from "next/server";
import { ThronePage } from "@/components/throne/ThronePage";
import { copy } from "@/lib/copy";
import { getThroneState } from "@/server/throne/state";

export const metadata: Metadata = {
  title: `${copy.throneName.daily} · ${copy.brand}`,
};

export default async function DailyThronePage() {
  await connection();
  const initial = await getThroneState("daily");
  return <ThronePage key="daily" throne="daily" initial={initial} />;
}
