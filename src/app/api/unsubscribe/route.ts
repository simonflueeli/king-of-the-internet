// OWNER: G. One-click unsubscribe from overthrow emails. GET is the link in the email footer and
// shows a confirmation page; POST is RFC 8058 one-click (List-Unsubscribe-Post) from mail clients.
// Both are authorized by the signed token alone and stop overthrow emails on all thrones.
import { eq } from "drizzle-orm";
import { copy } from "@/lib/copy";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { customers } from "@/server/db/schema";
import { appUrl, verifyUnsubscribeToken } from "@/server/email/links";
import { escapeHtml } from "@/server/email/templates";

async function unsubscribe(req: Request): Promise<boolean> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const payload = token ? verifyUnsubscribeToken(token) : null;
  if (!payload || !/^[0-9a-f-]{36}$/i.test(payload.c)) return false;
  const db = await getDb();
  const updated = await db
    .update(customers)
    .set({ unsubscribedAt: now() })
    .where(eq(customers.id, payload.c))
    .returning({ id: customers.id });
  return updated.length > 0;
}

export async function GET(req: Request): Promise<Response> {
  const ok = await unsubscribe(req);
  return page(ok);
}

export async function POST(req: Request): Promise<Response> {
  const ok = await unsubscribe(req);
  return new Response(ok ? "Unsubscribed" : "Invalid link", {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function page(ok: boolean): Response {
  const g = copy.growth;
  const title = ok ? g.unsubscribeTitle : g.unsubscribeInvalidTitle;
  const body = ok ? g.unsubscribeBody : g.unsubscribeInvalidBody;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)} · ${escapeHtml(copy.brand)}</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;
  font-family:"Schibsted Grotesk",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#F5F4FB;
  background:radial-gradient(ellipse 80% 50% at 50% 0%,rgba(255,214,120,.22),rgba(255,214,120,0) 70%),#121A5C;}
main{max-width:30rem;text-align:center;}
.mark{font-family:"UnifrakturMaguntia",Georgia,serif;font-size:2rem;color:#F2C75C;margin:0 0 1.5rem;}
h1{font-size:1.5rem;margin:0 0 .75rem;}
p{color:#BFC4EA;line-height:1.55;margin:0 0 1.5rem;}
a{display:inline-block;padding:.8rem 1.4rem;border-radius:16px;font-weight:800;color:#231803;text-decoration:none;
  background:linear-gradient(180deg,#FFE6A3 0%,#EDBC4C 47%,#D69E2C 53%,#E9B848 100%);box-shadow:0 4px 0 #835610;}
a:focus-visible{outline:3px solid #FFE7A0;outline-offset:3px;}
</style></head>
<body><main>
<p class="mark">${escapeHtml(copy.brand)}</p>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
<a href="${escapeHtml(appUrl(ok ? "/" : "/legal/contact"))}">${escapeHtml(ok ? g.backToThrone : copy.growth.contactLink)}</a>
</main></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
