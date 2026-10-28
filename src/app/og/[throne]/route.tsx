// OWNER: G. OG image for a throne page showing the current king (FR-72), refreshed at least every
// 5 minutes (in-process cache keyed by throne version and live minimum, plus HTTP caching ≤ 5 min).
import { copy, fill } from "@/lib/copy";
import { shareMoney } from "@/components/share/format";
import { getThroneState, isThroneId } from "@/server/throne/state";
import { cachedPng, renderOg } from "../_render";

const TTL_MS = 5 * 60_000;
const HEADERS = { "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=60" };

export async function GET(_req: Request, { params }: { params: Promise<{ throne: string }> }): Promise<Response> {
  const { throne } = await params;
  if (!isThroneId(throne)) return new Response("Not found", { status: 404 });
  const state = await getThroneState(throne);
  const price = shareMoney(state.minCents);
  const king = state.king;
  const key = `throne:${throne}:${state.version}:${state.minCents}:${king?.id ?? "-"}`;
  return cachedPng(
    key,
    TTL_MS,
    () =>
      renderOg(
        king
          ? { kind: "king", throne, title: king.title, name: king.name, amount: shareMoney(king.paidCents), chip: fill(copy.growth.ogTakeFor, { price }) }
          : { kind: "vacant", throne, chip: fill(copy.growth.ogClaimFor, { price }) },
        {},
      ),
    HEADERS,
  );
}
