// True seven-segment glyphs (a-g, clockwise from top) built as SVG polygons —
// not a decorative mono font standing in for "technical." Unlit segments
// render as faint ghost cells (never simply absent) so the "off" state is
// drawn as deliberately as the "on" one, per the seven-segment display world
// this landing page commits to (see .impeccable/surfaces/src-app-page-tsx.md).

const SEGMENTS: Record<string, string> = {
  //           a      b      c      d      e      f      g
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgecd",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
  " ": "",
};

// Polygon points for a 40x64 cell, six-pixel-thick strokes.
const PATHS: Record<string, string> = {
  a: "8,4 32,4 28,9 12,9",
  b: "34,6 34,30 29,27 29,11",
  c: "34,34 34,58 29,53 29,37",
  d: "8,60 32,60 28,55 12,55",
  e: "6,34 6,58 11,53 11,37",
  f: "6,6 6,30 11,27 11,11",
  g: "9,32 13,28 27,28 31,32 27,36 13,36",
};

export function SevenSegmentDigit({
  char,
  color,
  size = 40,
}: {
  char: string;
  color: string;
  size?: number;
}) {
  const lit = SEGMENTS[char] ?? "";
  return (
    <svg
      viewBox="0 0 40 64"
      aria-hidden="true"
      style={{
        // clamp() instead of a fixed pixel width — three side-by-side
        // readouts at a fixed size overflowed a narrow phone viewport
        // instead of shrinking (the vw-based preferred value hits the
        // clamp's max well before any desktop width, so this looks
        // identical to a fixed size everywhere but the smallest screens).
        width: `clamp(18px, 7vw, ${size}px)`,
        height: `clamp(28.8px, 11.2vw, ${size * 1.6}px)`,
        overflow: "visible",
        flexShrink: 0,
      }}
    >
      {Object.entries(PATHS).map(([key, points]) => {
        const isLit = lit.includes(key);
        return (
          <polygon
            key={key}
            points={points}
            fill={isLit ? color : "rgba(255, 255, 255, 0.05)"}
            style={{
              transition: "fill 0.4s ease, filter 0.4s ease",
              filter: isLit ? `drop-shadow(0 0 6px ${color})` : "none",
            }}
          />
        );
      })}
    </svg>
  );
}

// A colon cell — its own slot in the mask, matching the digit cell's height.
export function SevenSegmentColon({ color, size = 40 }: { color: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 14 64"
      aria-hidden="true"
      style={{
        width: `clamp(6.3px, 2.45vw, ${size * 0.35}px)`,
        height: `clamp(28.8px, 11.2vw, ${size * 1.6}px)`,
        flexShrink: 0,
      }}
    >
      <circle cx="7" cy="22" r="4" fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
      <circle cx="7" cy="42" r="4" fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
    </svg>
  );
}

// Renders a full readout — digits plus an optional trailing unit glyph (e.g.
// "%") drawn as a small lit dot-pair rather than a real font glyph, keeping
// every character inside the mask.
export function SevenSegmentReadout({
  value,
  color,
  size = 40,
}: {
  value: string;
  color: string;
  size?: number;
}) {
  return (
    <div style={{ display: "inline-flex", alignItems: "flex-end", gap: "4px" }}>
      {value.split("").map((ch, i) =>
        ch === ":" ? (
          <SevenSegmentColon key={i} color={color} size={size} />
        ) : (
          <SevenSegmentDigit key={i} char={ch} color={color} size={size} />
        )
      )}
    </div>
  );
}
