// OWNER: G. Dark stage (spotlight beam, floor glow, ermine hem) used by the reign share pages and
// the legal pages' header. Server component.
import Link from "next/link";
import { copy } from "@/lib/copy";
import s from "./share.module.css";

export function Stage({ children, chip }: { children?: React.ReactNode; chip?: string }) {
  return (
    <>
      <div className={s.stage}>
        <div className={s.beam} aria-hidden="true" />
        <div className={s.inner}>
          <header className={s.header}>
            <Link href="/" className={s.mark}>
              {copy.brand}
            </Link>
            {chip ? <span className={s.chip}>{chip}</span> : null}
          </header>
          {children}
        </div>
      </div>
      <div className={s.hem} aria-hidden="true" />
    </>
  );
}

export function CrownIcon() {
  return (
    <svg viewBox="0 0 64 44" aria-hidden="true" className={s.crownIcon}>
      <path fill="currentColor" d="M4 14 16 24 32 4 48 24 60 14 55 36H9Z" />
      <rect x="9" y="38" width="46" height="5" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function LegalLinks() {
  const n = copy.growth.legalNav;
  const links: [string, string][] = [
    ["/legal/terms", n.terms],
    ["/legal/privacy", n.privacy],
    ["/legal/imprint", n.imprint],
    ["/legal/contact", n.contact],
    ["/legal/refunds", n.refunds],
  ];
  return (
    <nav aria-label="Legal" className={s.legalLinks}>
      {links.map(([href, label]) => (
        <Link key={href} href={href}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
