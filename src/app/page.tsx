// OWNER: U. Placeholder shipped by F — U replaces it with the real throne page.
// Reads the live state so a first visit creates and migrates the local database.
import { connection } from "next/server";
import { copy, fill } from "@/lib/copy";
import { crestSvg } from "@/lib/crest";
import { formatMoney } from "@/lib/format";
import { getThroneState } from "@/server/throne/state";
import styles from "./page.module.css";

export default async function Home() {
  await connection(); // render per request, never at build time
  const state = await getThroneState("eternal");
  const kingName = state.king?.name ?? null;
  const price = formatMoney(state.minCents, { locale: "en-IE" });

  return (
    <main className={styles.stage}>
      <span className={styles.mark}>{copy.brand}</span>
      <div className={styles.crest} dangerouslySetInnerHTML={{ __html: crestSvg(kingName, { size: 110 }) }} />
      <p className={styles.hail}>{kingName ? copy.greetingReigning : copy.vacantNever}</p>
      <h1 className={kingName ? `${styles.king} ${styles.kingName}` : styles.king}>{kingName ?? copy.vacantName}</h1>
      <p className={styles.price}>
        {kingName ? fill(copy.ctaOverthrow, { name: kingName, price }) : fill(copy.ctaVacant, { price })}
      </p>
    </main>
  );
}
