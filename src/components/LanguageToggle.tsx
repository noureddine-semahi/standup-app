"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

// English/Spanish switch — same slider mechanic and flanking-label layout
// as ThemeToggle (which it's always placed next to), just "EN"/"ES" instead
// of moon/sun icons.
export default function LanguageToggle({ size = "md" }: { size?: "sm" | "md" }) {
  const { language, setLanguage } = useLanguage();

  function handleToggle(e: React.MouseEvent) {
    // Defensive: safe to place next to (or inside) a clickable row/Link
    // without also triggering that row's own navigation/action.
    e.preventDefault();
    e.stopPropagation();
    setLanguage(language === "en" ? "es" : "en");
  }

  const width = size === "sm" ? 40 : 52;
  const height = size === "sm" ? 22 : 28;
  const knob = size === "sm" ? 16 : 22;
  const labelSize = size === "sm" ? "0.6rem" : "0.68rem";

  return (
    <span className="inline-flex items-center flex-shrink-0" style={{ gap: size === "sm" ? "4px" : "6px" }}>
      <span aria-hidden="true" style={{ fontSize: labelSize, lineHeight: 1, fontWeight: 700, opacity: language === "en" ? 1 : 0.5 }}>
        EN
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={language === "es"}
        aria-label={language === "es" ? "Switch to English" : "Switch to Spanish"}
        onClick={handleToggle}
        className="relative rounded-full transition-colors flex-shrink-0"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          background: language === "es" ? "var(--accent-blue)" : "rgba(var(--tint-rgb),0.15)",
          border: "1px solid rgba(var(--tint-rgb),0.18)",
        }}
      >
        <span
          className="absolute rounded-full bg-white transition-transform"
          style={{
            width: `${knob}px`,
            height: `${knob}px`,
            top: "2px",
            left: "2px",
            transform: language === "es" ? `translateX(${width - knob - 4}px)` : "translateX(0)",
          }}
        />
      </button>
      <span aria-hidden="true" style={{ fontSize: labelSize, lineHeight: 1, fontWeight: 700, opacity: language === "es" ? 1 : 0.5 }}>
        ES
      </span>
    </span>
  );
}
