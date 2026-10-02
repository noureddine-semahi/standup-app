"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { getStoredTheme, setTheme, onThemeChange, type Theme } from "@/lib/theme";
import { updateThemePreference } from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

// Dark/light switch — same slider look as the Settings page's Appearance
// toggle, but flanked by static moon/sun icons instead of a trailing text
// label, for spots (Profile page, the mobile dropdown) that only have room
// for a compact control.
export default function ThemeToggle({ size = "md" }: { size?: "sm" | "md" }) {
  const { t } = useLanguage();
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    setThemeState(getStoredTheme());
    return onThemeChange((t) => setThemeState(t));
  }, []);

  function handleToggle(e: React.MouseEvent) {
    // Defensive: safe to place next to (or inside) a clickable row/Link
    // without also triggering that row's own navigation/action.
    e.preventDefault();
    e.stopPropagation();
    const next: Theme = theme === "dark" ? "light" : "dark";
    setThemeState(next);
    setTheme(next);
    updateThemePreference(next).catch(() => {});
  }

  const width = size === "sm" ? 40 : 52;
  const height = size === "sm" ? 22 : 28;
  const knob = size === "sm" ? 16 : 22;
  const iconSize = size === "sm" ? 12 : 14;

  return (
    <span className="inline-flex items-center flex-shrink-0" style={{ gap: size === "sm" ? "4px" : "6px" }}>
      <span aria-hidden="true" className="inline-flex text-white/70" style={{ lineHeight: 1 }}>
        <Moon size={iconSize} />
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={theme === "light"}
        aria-label={theme === "light" ? t("theme.switchToDark") : t("theme.switchToLight")}
        onClick={handleToggle}
        className="relative rounded-full transition-all flex-shrink-0"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          background:
            theme === "light"
              ? "linear-gradient(to bottom, rgba(255,255,255,0.2) 0%, transparent 45%), linear-gradient(to bottom, color-mix(in srgb, var(--accent-purple) 85%, white 10%), color-mix(in srgb, var(--accent-purple) 70%, black 15%))"
              : "linear-gradient(to bottom, rgba(255,255,255,0.1) 0%, transparent 45%), linear-gradient(to bottom, rgba(var(--tint-rgb),0.22), rgba(var(--tint-rgb),0.08))",
          border: "1px solid rgba(var(--tint-rgb),0.18)",
          boxShadow:
            theme === "light"
              ? "inset 0 1px 0 0 rgba(255,255,255,0.3), inset 0 -1px 2px 0 rgba(0,0,0,0.3), 0 1px 3px -1px rgba(0,0,0,0.3), 0 0 8px -1px var(--accent-purple)"
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
            transform: theme === "light" ? `translateX(${width - knob - 4}px)` : "translateX(0)",
          }}
        />
      </button>
      <span aria-hidden="true" className="inline-flex text-amber-300/80" style={{ lineHeight: 1 }}>
        <Sun size={iconSize} />
      </span>
    </span>
  );
}
