export type Tone = "neutral" | "yellow" | "emerald" | "violet" | "red" | "amber";

export type ToneStyle = {
  bg: string;
  border: string;
  glow: string;
};

export function toneStyles(tone: Tone): ToneStyle {
  switch (tone) {
    case "red":
      return {
        bg: "rgba(239, 68, 68, 0.07)",
        border: "rgba(239, 68, 68, 0.22)",
        glow: "0 4px 14px rgba(0, 0, 0, 0.18)",
      };
    case "amber":
      return {
        bg: "rgba(245, 158, 11, 0.07)",
        border: "rgba(245, 158, 11, 0.24)",
        glow: "0 4px 14px rgba(0, 0, 0, 0.18)",
      };
    case "yellow":
      return {
        bg: "rgba(250, 204, 21, 0.06)",
        border: "rgba(250, 204, 21, 0.20)",
        glow: "0 4px 14px rgba(0, 0, 0, 0.18)",
      };
    case "emerald":
      return {
        bg: "rgba(16, 185, 129, 0.06)",
        border: "rgba(16, 185, 129, 0.20)",
        glow: "0 4px 14px rgba(0, 0, 0, 0.18)",
      };
    case "violet":
      return {
        bg: "rgba(168, 85, 247, 0.06)",
        border: "rgba(168, 85, 247, 0.18)",
        glow: "0 4px 14px rgba(0, 0, 0, 0.18)",
      };
    case "neutral":
    default:
      return {
        bg: "rgba(255, 255, 255, 0.03)",
        border: "rgba(255, 255, 255, 0.08)",
        glow: "0 4px 14px rgba(0, 0, 0, 0.18)",
      };
  }
}
