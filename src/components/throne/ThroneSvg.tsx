// OWNER: U. The gold throne illustration from the prototype, with the crest on the backrest (FR-01/02).
import { memo } from "react";
import { crestGroup } from "@/lib/crest";

export const ThroneSvg = memo(function ThroneSvg({ crestName, className }: { crestName: string | null; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 230" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE7A0" />
          <stop offset=".45" stopColor="#E2B04A" />
          <stop offset="1" stopColor="#9C6B12" />
        </linearGradient>
        <linearGradient id="gGoldSide" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#9C6B12" />
          <stop offset=".5" stopColor="#F3CD6A" />
          <stop offset="1" stopColor="#9C6B12" />
        </linearGradient>
        <linearGradient id="gVelvet" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B8304A" />
          <stop offset="1" stopColor="#6A1024" />
        </linearGradient>
        <radialGradient id="gShadow">
          <stop offset="0" stopColor="#000" stopOpacity=".5" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="219" rx="84" ry="9" fill="url(#gShadow)" />
      <rect x="44" y="168" width="14" height="46" rx="3" fill="url(#gGoldSide)" />
      <rect x="142" y="168" width="14" height="46" rx="3" fill="url(#gGoldSide)" />
      <rect x="39" y="208" width="24" height="9" rx="3" fill="url(#gGold)" />
      <rect x="137" y="208" width="24" height="9" rx="3" fill="url(#gGold)" />
      <path d="M46 134V60C46 32 70 18 100 13 130 18 154 32 154 60V134Z" fill="url(#gGold)" stroke="#8A5C10" strokeWidth="1.5" />
      <path d="M57 130V63C57 42 75 31 100 27 125 31 143 42 143 63V130Z" fill="url(#gVelvet)" />
      <path d="M57 130V63C57 42 75 31 100 27 125 31 143 42 143 63V130" fill="none" stroke="#FFE7A0" strokeOpacity=".35" strokeWidth="1" />
      <circle cx="46" cy="52" r="7.5" fill="url(#gGold)" stroke="#8A5C10" />
      <circle cx="154" cy="52" r="7.5" fill="url(#gGold)" stroke="#8A5C10" />
      <path d="M86 16 90 2 100 10 110 2 114 16Z" fill="url(#gGold)" stroke="#8A5C10" />
      <circle cx="100" cy="11" r="2.6" fill="#B8304A" />
      <g transform="translate(70 42) scale(.6)" dangerouslySetInnerHTML={{ __html: crestGroup(crestName, { idPrefix: "throne" }) }} />
      <rect x="27" y="138" width="11" height="34" fill="url(#gGoldSide)" />
      <rect x="162" y="138" width="11" height="34" fill="url(#gGoldSide)" />
      <path d="M27 124H70V141H27C20 141 17 135 19 130 21 126 24 124 27 124Z" fill="url(#gGold)" stroke="#8A5C10" />
      <path d="M173 124H130V141H173C180 141 183 135 181 130 179 126 176 124 173 124Z" fill="url(#gGold)" stroke="#8A5C10" />
      <rect x="44" y="131" width="112" height="17" rx="8" fill="url(#gVelvet)" />
      <path d="M38 146H162V171C162 175 158 178 154 178H46C42 178 38 175 38 171Z" fill="url(#gGold)" stroke="#8A5C10" />
      <path d="M52 156H148" stroke="#8A5C10" strokeWidth="1.5" strokeOpacity=".55" />
      <circle cx="100" cy="165" r="5.5" fill="#B8304A" stroke="#8A5C10" />
      <circle cx="72" cy="165" r="3" fill="#2B4BB3" stroke="#8A5C10" />
      <circle cx="128" cy="165" r="3" fill="#2B4BB3" stroke="#8A5C10" />
    </svg>
  );
});

/** Crown icon used in the primary button and the record chip. */
export function CrownIcon() {
  return (
    <svg viewBox="0 0 64 44" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M4 14 16 24 32 4 48 24 60 14 55 36H9Z" />
      <rect x="9" y="38" width="46" height="5" rx="1.5" fill="currentColor" />
    </svg>
  );
}
