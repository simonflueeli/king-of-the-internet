// OWNER: U. Tabular figures for prices and timers (PRD "Typography") without the font's tabular punctuation:
// Schibsted Grotesk's `tnum` also gives "," and "." a digit-wide advance ("2 , 00 €"), so only digit runs
// get tabular-nums (globals.css `.tabular`) and separators keep their normal width.
const DIGITS = /(\d+)/;

export function Tnum({ children }: { children: string }) {
  const parts = children.split(DIGITS);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="tabular">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}
