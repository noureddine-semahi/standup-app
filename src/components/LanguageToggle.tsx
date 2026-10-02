"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

// English/Spanish switch — same slider mechanic and flanking-label layout
// as ThemeToggle (which it's always placed next to), just "EN"/"ES" instead
// of moon/sun icons.
export default function LanguageToggle({ size = "md" }: { size?: "sm" | "md" }) {
  const { language, setLanguage, t } = useLanguage();

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
        aria-label={language === "es" ? t("language.switchToEnglish") : t("language.switchToSpanish")}
        onClick={handleToggle}
        className="relative rounded-full transition-all flex-shrink-0"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          background:
            language === "es"
              ? "linear-gradient(to bottom, rgba(255,255,255,0.2) 0%, transparent 45%), linear-gradient(to bottom, color-mix(in srgb, var(--accent-blue) 85%, white 10%), color-mix(in srgb, var(--accent-blue) 70%, black 15%))"
              : "linear-gradient(to bottom, rgba(255,255,255,0.1) 0%, transparent 45%), linear-gradient(to bottom, rgba(var(--tint-rgb),0.22), rgba(var(--tint-rgb),0.08))",
          border: "1px solid rgba(var(--tint-rgb),0.18)",
          boxShadow:
            language === "es"
              ? "inset 0 1px 0 0 rgba(255,255,255,0.3), inset 0 -1px 2px 0 rgba(0,0,0,0.3), 0 1px 3px -1px rgba(0,0,0,0.3), 0 0 8px -1px var(--accent-blue)"
              : "inset 0 1px 0 0 rgba(255,255,255,0.1), inset 0 -1px 2px 0 rgba(0,0,0,0.3), 0 1px 3px -1px rgba(0,0,0,0.3)",
        }}
      >
        <span
          className="absolute rounded-full transition-transform"
          style={{
            width: `${knob}px`,
            height: `${knob}px`,
            top: "2px",
            left: "2px",
            background: "radial-gradient(circle at 32% 28%, #ffffff 0%, #e4e9f0 45%, #a8b2c0 100%)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.45), inset 0 1px 1px 0 rgba(255,255,255,0.9), inset 0 -1px 1px 0 rgba(0,0,0,0.12)",
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
