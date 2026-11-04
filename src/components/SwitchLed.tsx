// LED set into a switch knob. The knob is near-white, so the LED needs a
// saturated body and a darker rim to read against it (a pale or white-hot
// LED disappears), plus a glow that spills onto the knob. Purely decorative --
// the switch itself carries the accessible state.
export default function SwitchLed({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "999px",
        background: `radial-gradient(circle at 34% 30%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 28%), ${color}`,
        boxShadow: [
          `0 0 0 1px color-mix(in srgb, ${color} 55%, black)`,
          `0 0 ${size}px ${Math.round(size / 3)}px color-mix(in srgb, ${color} 75%, transparent)`,
          `inset 0 -1px 1px rgba(0,0,0,0.3)`,
        ].join(", "),
        transition: "background 0.2s ease, box-shadow 0.2s ease",
      }}
    />
  );
}
