// OWNER: G. OG image for a reign page (FR-71); generic image for hidden/removed reigns (FR-73).
import { loadShare } from "@/app/r/[reignId]/share-data";
import { shareMoney } from "@/components/share/format";
import { cachedPng, renderOg } from "../../_render";

// Reign content never changes except being hidden, so the key includes the visibility.
const TTL_MS = 10 * 60_000;
const HEADERS = { "cache-control": "public, max-age=300, s-maxage=600, stale-while-revalidate=600" };

export async function GET(_req: Request, { params }: { params: Promise<{ reignId: string }> }): Promise<Response> {
  const { reignId } = await params;
  const data = await loadShare(reignId);
  if (!data || data.kind === "hidden") {
    return cachedPng("generic", TTL_MS, () => renderOg({ kind: "generic" }, {}), HEADERS);
  }
  const r = data.reign;
  return cachedPng(
    `reign:${r.id}`,
    TTL_MS,
    () => renderOg({ kind: "king", throne: r.throne, title: r.title, name: r.name, amount: shareMoney(r.paidCents) }, {}),
    HEADERS,
  );
}
