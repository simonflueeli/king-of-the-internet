// OWNER: G. Raw HTML of one outbox email (dev only; 404 in production).
import { readOutboxHtml } from "@/server/email/outbox";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const { id } = await params;
  const html = await readOutboxHtml(id);
  if (html === null) return new Response("Not found", { status: 404 });
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // Opened directly from /dev/outbox ("Open in a new tab"); emails never need scripts.
      "content-security-policy": "script-src 'none'",
    },
  });
}
