// OWNER: G. Shared shell for the legal pages (PRD "Legal and compliance"). Placeholder text only:
// everything marked <Todo /> must be supplied by the operator's lawyer before launch.
import Link from "next/link";
import { copy } from "@/lib/copy";
import { LegalLinks, Stage } from "@/components/share/Stage";
import s from "./legal.module.css";

export type LegalSlug = keyof typeof copy.growth.legalNav;
const ORDER: LegalSlug[] = ["terms", "privacy", "imprint", "contact", "refunds"];

export function Todo({ what }: { what?: string }) {
  return <mark className={s.todo}>[TO BE SUPPLIED BY LEGAL{what ? `: ${what}` : ""}]</mark>;
}

export function LegalDoc({ slug, children }: { slug: LegalSlug; children: React.ReactNode }) {
  const nav = copy.growth.legalNav;
  return (
    <>
      <Stage>
        <h1 className={s.title}>{nav[slug]}</h1>
        <ul className={s.nav} aria-label="Legal pages">
          {ORDER.map((k) => (
            <li key={k}>
              <Link href={`/legal/${k}`} aria-current={k === slug ? "page" : undefined}>
                {nav[k]}
              </Link>
            </li>
          ))}
        </ul>
      </Stage>
      <main className={s.doc}>
        <p className={s.draft} role="note">
          {copy.growth.legalDraftNotice}
        </p>
        {children}
        <p className={s.updated}>
          Last updated: <Todo what="date" />
        </p>
      </main>
      <LegalLinks />
    </>
  );
}

export const legalStyles = s;
