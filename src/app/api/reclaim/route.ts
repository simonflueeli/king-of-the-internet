// OWNER: G. "Reclaim my throne" link from the overthrow email: verify the signed token and send the
// old king to the throne with checkout open and their name prefilled. The price shown there is
// always the live minimum. Invalid or expired tokens fall back to the throne without prefill.
import { eq } from "drizzle-orm";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { analyticsEvents, reigns } from "@/server/db/schema";
import { appUrl, thronePath, verifyReclaimToken } from "@/server/email/links";

export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const payload = token ? verifyReclaimToken(token) : null;
  if (!payload) return redirect(appUrl("/"));

  const db = await getDb();
  const [reign] = /^[0-9a-f-]{36}$/i.test(payload.r)
    ? await db.select().from(reigns).where(eq(reigns.id, payload.r))
    : [];
  const target = new URL(appUrl(thronePath(payload.t)));
  target.searchParams.set("checkout", "1");
  // A reign hidden by moderation does not get its name back through a link.
  if (reign && !reign.hidden) target.searchParams.set("name", reign.name);

  const overthrownAt = reign?.endedAt ?? null;
  try {
    await db.insert(analyticsEvents).values({
      name: "overthrow_email_clicked",
      props: {
        throne: payload.t,
        minutes_since_overthrow: overthrownAt ? Math.max(0, Math.floor((now().getTime() - overthrownAt.getTime()) / 60_000)) : null,
      },
      createdAt: now(),
    });
  } catch (err) {
    console.error("[reclaim] analytics insert failed", err);
  }
  return redirect(target.toString());
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
