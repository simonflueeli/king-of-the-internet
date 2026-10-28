// OWNER: G. Public reign page /r/{reignId} (FR-70) with Open Graph / Twitter meta pointing at the
// generated image (FR-71, AC-22). Hidden or removed reigns get a neutral page (FR-73).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { copy, fill } from "@/lib/copy";
import { formatAgo, formatDuration, truncateName } from "@/lib/format";
import { CrownIcon, LegalLinks, Stage } from "@/components/share/Stage";
import { ShareButton } from "@/components/share/ShareButton";
import { shareMoney } from "@/components/share/format";
import { throneSvg } from "@/components/share/throne-svg";
import s from "@/components/share/share.module.css";
import { now } from "@/server/clock";
import { appUrl, thronePath } from "@/server/email/links";
import { loadShare } from "./share-data";

type Props = { params: Promise<{ reignId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const { reignId } = await params;
  const data = await loadShare(reignId);
  if (!data) return { title: copy.brand, robots: { index: false } };
  const g = copy.growth;
  const image = { url: `/og/r/${reignId}`, width: 1200, height: 630, alt: "" };
  if (data.kind === "hidden") {
    image.alt = copy.brand;
    return {
      title: `${g.shareHiddenTitle} · ${copy.brand}`,
      description: g.shareMetaHiddenDescription,
      robots: { index: false },
      openGraph: { title: copy.brand, description: g.shareMetaHiddenDescription, images: [image], type: "website", siteName: copy.brand },
      twitter: { card: "summary_large_image", title: copy.brand, description: g.shareMetaHiddenDescription, images: [image] },
    };
  }
  const r = data.reign;
  const vars = { title: r.title, name: r.name, throneName: copy.throneName[r.throne], amount: shareMoney(r.paidCents) };
  const title = fill(g.shareMetaTitle, vars);
  const description = fill(g.shareMetaDescription, vars);
  image.alt = `${r.title} ${r.name}`;
  return {
    title: `${title} · ${copy.brand}`,
    description,
    alternates: { canonical: `/r/${reignId}` },
    openGraph: { title, description, url: `/r/${reignId}`, images: [image], type: "website", siteName: copy.brand },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function ReignPage({ params }: Props) {
  await connection();
  const { reignId } = await params;
  const data = await loadShare(reignId);
  if (!data) notFound();
  const g = copy.growth;

  if (data.kind === "hidden") {
    return (
      <>
        <Stage chip={copy.switchLabel[data.throne]}>
          <div className={s.scene}>
            <div className={s.throne} dangerouslySetInnerHTML={{ __html: throneSvg(null, { idPrefix: "hidden" }) }} />
            <h1 className={s.kingPlain}>{g.shareHiddenTitle}</h1>
            <p className={s.lede}>{g.shareHiddenBody}</p>
          </div>
        </Stage>
        <main className={s.main}>
          <Link className={s.cta} href={thronePath(data.throne)}>
            <CrownIcon />
            <span>{g.shareHiddenCta}</span>
          </Link>
        </main>
        <LegalLinks />
      </>
    );
  }

  const r = data.reign;
  const throneLabel = copy.throneLabel[r.throne];
  const crownedAgo = formatAgo(now().getTime() - new Date(r.startedAt).getTime());
  const ctaLabel = data.live ? fill(g.shareCtaLive, { name: truncateName(r.name) }) : fill(g.shareCtaEnded, { throneLabel });

  return (
    <>
      <Stage chip={copy.switchLabel[r.throne]}>
        <div className={s.scene}>
          <div className={s.throne} dangerouslySetInnerHTML={{ __html: throneSvg(r.name, { idPrefix: `r${r.id.slice(0, 8)}` }) }} />
          {data.live ? <p className={s.hail}>{copy.greetingReigning}</p> : null}
          <h1 className={s.king}>{fill(copy.hallName, { title: r.title, name: r.name })}</h1>
          <p className={s.plate}>{fill(copy.titlePlate, { title: r.title, throneName: copy.throneName[r.throne] })}</p>
          {data.proclamation ? <p className={s.proclamation}>“{data.proclamation}”</p> : null}
          <p className={s.status}>
            {data.live ? (
              <span className={s.statusLive}>
                <span className={s.liveDot} aria-hidden="true" />
                {g.shareReigningNow} · {fill(g.shareCrowned, { ago: crownedAgo })}
              </span>
            ) : (
              fill(g.shareRuledFor, { duration: formatDuration(data.lengthMs) })
            )}
          </p>
        </div>
      </Stage>
      <main className={s.main}>
        <p className={s.paid}>{fill(g.sharePaid, { amount: shareMoney(r.paidCents), throneLabel })}</p>
        <Link className={s.cta} href={thronePath(r.throne)}>
          <CrownIcon />
          <span>{ctaLabel}</span>
        </Link>
        <div>
          <ShareButton
            url={appUrl(`/r/${r.id}`)}
            title={fill(g.shareMetaTitle, { title: r.title, name: r.name, throneName: copy.throneName[r.throne] })}
            label={g.shareButton}
            copiedLabel={g.shareCopied}
          />
        </div>
      </main>
      <LegalLinks />
    </>
  );
}
