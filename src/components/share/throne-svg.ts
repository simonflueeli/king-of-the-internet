// OWNER: G. The prototype's throne (gold frame, crimson velvet, ruby and sapphire studs) with the
// king's crest on the backrest, as a standalone SVG string. Used by the share page and, without the
// crest's <text> initial (drawn separately in the right font), by the OG images.
import { crestGroup } from "@/lib/crest";

/** The crest sits on the backrest at translate(70 42) scale(.6) in the 200 × 230 throne box. */
export const THRONE_VIEWBOX = { width: 200, height: 230 };
export const CREST_ON_THRONE = { x: 70, y: 42, scale: 0.6, roundel: { cx: 50, cy: 56, r: 21 }, fontSize: 30 };

export function throneSvg(name: string | null, opts?: { idPrefix?: string; withInitial?: boolean }): string {
  const p = opts?.idPrefix ?? "throne";
  let crest = crestGroup(name, { idPrefix: `${p}-crest` });
  if (opts?.withInitial === false) crest = crest.replace(/<text[\s\S]*?<\/text>/, "");
  const gold = `url(#${p}-gold)`;
  const side = `url(#${p}-side)`;
  const velvet = `url(#${p}-velvet)`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 230" aria-hidden="true">` +
    `<defs>` +
    `<linearGradient id="${p}-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE7A0"/><stop offset=".45" stop-color="#E2B04A"/><stop offset="1" stop-color="#9C6B12"/></linearGradient>` +
    `<linearGradient id="${p}-side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9C6B12"/><stop offset=".5" stop-color="#F3CD6A"/><stop offset="1" stop-color="#9C6B12"/></linearGradient>` +
    `<linearGradient id="${p}-velvet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B8304A"/><stop offset="1" stop-color="#6A1024"/></linearGradient>` +
    `<radialGradient id="${p}-shadow"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>` +
    `</defs>` +
    `<ellipse cx="100" cy="219" rx="84" ry="9" fill="url(#${p}-shadow)"/>` +
    `<rect x="44" y="168" width="14" height="46" rx="3" fill="${side}"/>` +
    `<rect x="142" y="168" width="14" height="46" rx="3" fill="${side}"/>` +
    `<rect x="39" y="208" width="24" height="9" rx="3" fill="${gold}"/>` +
    `<rect x="137" y="208" width="24" height="9" rx="3" fill="${gold}"/>` +
    `<path d="M46 134V60C46 32 70 18 100 13 130 18 154 32 154 60V134Z" fill="${gold}" stroke="#8A5C10" stroke-width="1.5"/>` +
    `<path d="M57 130V63C57 42 75 31 100 27 125 31 143 42 143 63V130Z" fill="${velvet}"/>` +
    `<path d="M57 130V63C57 42 75 31 100 27 125 31 143 42 143 63V130" fill="none" stroke="#FFE7A0" stroke-opacity=".35" stroke-width="1"/>` +
    `<circle cx="46" cy="52" r="7.5" fill="${gold}" stroke="#8A5C10"/>` +
    `<circle cx="154" cy="52" r="7.5" fill="${gold}" stroke="#8A5C10"/>` +
    `<path d="M86 16 90 2 100 10 110 2 114 16Z" fill="${gold}" stroke="#8A5C10"/>` +
    `<circle cx="100" cy="11" r="2.6" fill="#B8304A"/>` +
    `<g transform="translate(70 42) scale(.6)">${crest}</g>` +
    `<rect x="27" y="138" width="11" height="34" fill="${side}"/>` +
    `<rect x="162" y="138" width="11" height="34" fill="${side}"/>` +
    `<path d="M27 124H70V141H27C20 141 17 135 19 130 21 126 24 124 27 124Z" fill="${gold}" stroke="#8A5C10"/>` +
    `<path d="M173 124H130V141H173C180 141 183 135 181 130 179 126 176 124 173 124Z" fill="${gold}" stroke="#8A5C10"/>` +
    `<rect x="44" y="131" width="112" height="17" rx="8" fill="${velvet}"/>` +
    `<path d="M38 146H162V171C162 175 158 178 154 178H46C42 178 38 175 38 171Z" fill="${gold}" stroke="#8A5C10"/>` +
    `<path d="M52 156H148" stroke="#8A5C10" stroke-width="1.5" stroke-opacity=".55"/>` +
    `<circle cx="100" cy="165" r="5.5" fill="#B8304A" stroke="#8A5C10"/>` +
    `<circle cx="72" cy="165" r="3" fill="#2B4BB3" stroke="#8A5C10"/>` +
    `<circle cx="128" cy="165" r="3" fill="#2B4BB3" stroke="#8A5C10"/>` +
    `</svg>`
  );
}

/** One ermine tile row (white fur, black spots) as a standalone SVG of the given width. */
export function ermineSvg(width: number, height = 30, fur = "#FFFFFF"): string {
  const spot =
    `<circle r="1.7"/><circle cx="-3.1" cy="2.7" r="1.7"/><circle cx="3.1" cy="2.7" r="1.7"/>` +
    `<path d="M0 3.2C-2.5 7-2.3 11.5 0 16.5 2.3 11.5 2.5 7 0 3.2Z"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><pattern id="ermine" width="34" height="37" patternUnits="userSpaceOnUse">` +
    `<g fill="#15151B" transform="scale(.85)"><g transform="translate(10 4)">${spot}</g><g transform="translate(30 26)">${spot}</g></g>` +
    `</pattern></defs>` +
    `<rect width="${width}" height="${height}" fill="${fur}"/><rect width="${width}" height="${height}" fill="url(#ermine)"/>` +
    `<rect width="${width}" height="3" fill="#E2B04A"/>` +
    `</svg>`
  );
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
