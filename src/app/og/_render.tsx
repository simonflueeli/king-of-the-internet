// OWNER: G. Stage-style Open Graph images (1200 × 630): throne with the crest, "<Title> <Name>",
// amount and throne name (FR-71, FR-72), or a generic image (FR-73). Fonts are bundled in
// ./_fonts (SIL OFL) so rendering needs no network.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { copy } from "@/lib/copy";
import type { ThroneId, Title } from "@/lib/contracts";
import { crestSpec } from "@/lib/crest";
import { CREST_ON_THRONE, ermineSvg, svgDataUri, throneSvg } from "@/components/share/throne-svg";

export const OG_SIZE = { width: 1200, height: 630 };

type FontDef = { name: string; data: ArrayBuffer; weight: 400 | 600 | 800; style: "normal" };
let fontsPromise: Promise<FontDef[]> | null = null;

function loadFonts(): Promise<FontDef[]> {
  const dir = path.join(process.cwd(), "src", "app", "og", "_fonts");
  const load = async (file: string, name: string, weight: FontDef["weight"]): Promise<FontDef> => {
    const buf = await readFile(path.join(dir, file));
    return { name, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, weight, style: "normal" };
  };
  fontsPromise ??= Promise.all([
    load("UnifrakturMaguntia-Regular.ttf", "Blackletter", 400),
    load("SchibstedGrotesk-SemiBold.ttf", "Sans", 600),
    load("SchibstedGrotesk-ExtraBold.ttf", "Sans", 800),
  ]).catch((err) => {
    fontsPromise = null;
    throw err;
  });
  return fontsPromise;
}

export type OgScene =
  | { kind: "king"; throne: ThroneId; title: Title; name: string; amount: string; chip?: string }
  | { kind: "vacant"; throne: ThroneId; chip: string }
  | { kind: "generic" };

const THRONE_W = 360;
const THRONE_H = Math.round((THRONE_W * 230) / 200);

/** Bigger for short names, smaller for long ones, so "<Title> <Name>" fits in two lines. */
function nameSize(text: string): number {
  const n = Array.from(text).length;
  if (n <= 12) return 104;
  if (n <= 18) return 88;
  if (n <= 24) return 74;
  return 62;
}

const BEAM = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="520" viewBox="0 0 900 520">` +
    `<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE296" stop-opacity=".30"/>` +
    `<stop offset=".7" stop-color="#FFE296" stop-opacity=".06"/><stop offset="1" stop-color="#FFE296" stop-opacity="0"/></linearGradient></defs>` +
    `<polygon points="369,0 531,0 900,520 0,520" fill="url(#b)"/></svg>`,
);
const ERMINE = svgDataUri(ermineSvg(OG_SIZE.width, 30));

function ThroneWithCrest({ name }: { name: string | null }) {
  const scale = THRONE_W / 200;
  const c = CREST_ON_THRONE;
  const cx = (c.x + c.roundel.cx * c.scale) * scale;
  const cy = (c.y + c.roundel.cy * c.scale) * scale;
  const box = c.roundel.r * 2 * c.scale * scale;
  const initial = crestSpec(name).initial;
  return (
    <div style={{ display: "flex", position: "relative", width: THRONE_W, height: THRONE_H }}>
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={svgDataUri(throneSvg(name, { idPrefix: "og", withInitial: false }))} width={THRONE_W} height={THRONE_H} />
      <div
        style={{
          position: "absolute",
          left: cx - box / 2,
          top: cy - box / 2,
          width: box,
          height: box,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Blackletter",
          fontSize: c.fontSize * c.scale * scale,
          color: "#2A1C05",
          lineHeight: 1,
        }}
      >
        {initial}
      </div>
    </div>
  );
}

// Satori drops text drawn with background-clip: text, so the gold name is a solid fill with a glow.
const goldText = { color: "#F6CF63", textShadow: "0 3px 14px rgba(255,200,90,0.35)" } as const;
const column = { display: "flex", flexDirection: "column", alignItems: "flex-start" } as const;

export async function renderOg(scene: OgScene, headers: Record<string, string>): Promise<Response> {
  const fonts = await loadFonts();
  const g = copy.growth;

  let right: React.ReactNode;
  let crestName: string | null = null;
  if (scene.kind === "king") {
    crestName = scene.name;
    const hall = `${scene.title} ${scene.name}`;
    right = (
      <div style={column}>
        <div style={{ display: "flex", fontSize: 34, fontWeight: 600, color: "#F2C75C" }}>{g.ogLongLive}</div>
        <div style={{ display: "flex", fontFamily: "Blackletter", fontSize: nameSize(hall), lineHeight: 1.05, marginTop: 6, ...goldText }}>
          {hall}
        </div>
        <div style={{ display: "flex", marginTop: 22 }}>
          <div
            style={{
              display: "flex",
              padding: "6px 18px",
              borderRadius: 8,
              fontSize: 28,
              fontWeight: 800,
              color: "#231803",
              backgroundImage: "linear-gradient(180deg, #FFE7A0, #E2B04A 55%, #C8921E)",
              boxShadow: "0 3px 0 #9C6B12",
            }}
          >
            {`${scene.title} of the ${copy.throneName[scene.throne]}`}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 26, gap: 18 }}>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 800, color: "#F5F4FB" }}>{scene.amount}</div>
          {scene.chip ? <div style={{ display: "flex", fontSize: 28, fontWeight: 600, color: "#BFC4EA" }}>{scene.chip}</div> : null}
        </div>
      </div>
    );
  } else if (scene.kind === "vacant") {
    right = (
      <div style={column}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: "#BFC4EA" }}>{copy.throneName[scene.throne]}</div>
        <div style={{ display: "flex", fontFamily: "Blackletter", fontSize: 92, lineHeight: 1.05, marginTop: 8, ...goldText }}>
          {g.ogVacant}
        </div>
        <div style={{ display: "flex", marginTop: 26, fontSize: 44, fontWeight: 800, color: "#F5F4FB" }}>{scene.chip}</div>
      </div>
    );
  } else {
    right = (
      <div style={column}>
        <div style={{ display: "flex", fontFamily: "Blackletter", fontSize: 120, lineHeight: 1, ...goldText }}>{copy.brand}</div>
        <div style={{ display: "flex", marginTop: 24, fontSize: 44, fontWeight: 800, color: "#F5F4FB" }}>{g.ogHidden}</div>
      </div>
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          fontFamily: "Sans",
          color: "#F5F4FB",
          backgroundColor: "#121A5C",
          backgroundImage:
            "radial-gradient(ellipse 60% 45% at 30% 78%, rgba(255,214,120,0.18), rgba(255,214,120,0) 70%), radial-gradient(ellipse 120% 80% at 50% 125%, rgba(0,0,0,0.5), rgba(0,0,0,0) 60%)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={BEAM} width={900} height={520} style={{ position: "absolute", left: -90, top: 0 }} />
        <div style={{ display: "flex", position: "absolute", left: 56, top: 34, fontFamily: "Blackletter", fontSize: 44, color: "#F2C75C" }}>
          {scene.kind === "generic" ? "" : copy.brand}
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", padding: "40px 64px 30px 56px", gap: 48 }}>
          <div style={{ display: "flex", flex: "none", marginTop: 40 }}>
            <ThroneWithCrest name={crestName} />
          </div>
          <div style={{ display: "flex", flex: 1, minWidth: 0 }}>{right}</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={ERMINE} width={OG_SIZE.width} height={30} />
      </div>
    ),
    { ...OG_SIZE, fonts, headers },
  );
}

/** Small in-process cache of rendered PNGs ("generated on demand and cached"). */
const MAX_ENTRIES = 200;
const pngCache = new Map<string, { png: ArrayBuffer; expires: number }>();

export async function cachedPng(key: string, ttlMs: number, render: () => Promise<Response>, headers: Record<string, string>): Promise<Response> {
  const hit = pngCache.get(key);
  const t = Date.now();
  let png: ArrayBuffer;
  if (hit && hit.expires > t) png = hit.png;
  else {
    const res = await render();
    png = await res.arrayBuffer();
    if (pngCache.size >= MAX_ENTRIES) pngCache.delete(pngCache.keys().next().value!);
    pngCache.set(key, { png, expires: t + ttlMs });
  }
  return new Response(png, { headers: { "content-type": "image/png", ...headers } });
}
