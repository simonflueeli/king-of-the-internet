// OWNER: U. The Eternal Throne. Renders the current state on the server; the client island keeps it live.
import { connection } from "next/server";
import { ThronePage } from "@/components/throne/ThronePage";
import { getThroneState } from "@/server/throne/state";

export default async function EternalThronePage() {
  await connection(); // render per request, never at build time
  const initial = await getThroneState("eternal");
  return <ThronePage key="eternal" throne="eternal" initial={initial} />;
}
