// OWNER: G. Formatting for share pages and OG images.
import { formatMoney } from "@/lib/format";

/** Server-rendered share text uses one fixed locale so pages and images match. */
export const SHARE_LOCALE = "en-IE";

export const shareMoney = (cents: number) => formatMoney(cents, { locale: SHARE_LOCALE });

