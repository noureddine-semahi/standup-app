"use client";

import { useEffect, useState } from "react";
import { getStoredTheme, setTheme, onThemeChange, type Theme } from "@/lib/theme";
import { updateThemePreference } from "@/lib/supabase/db";

// Dark/light switch — same slider look as the Settings page's Appearance
// toggle, but flanked by static 🌙/☀️ icons instead of a trailing text
// label, for spots (Profile page, the mobile dropdown) that only have room
// for a compact control.
export default function ThemeToggle({ size = "md" }: { size?: "sm" | "md" }) {
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
  const iconSize = size === "sm" ? "0.75rem" : "0.9rem";

  return (
    <span className="inline-flex items-center flex-shrink-0" style={{ gap: size === "sm" ? "4px" : "6px" }}>
      <span aria-hidden="true" style={{ fontSize: iconSize, lineHeight: 1 }}>
        🌙
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={theme === "light"}
        aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        onClick={handleToggle}
        className="relative rounded-full transition-colors flex-shrink-0"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          background: theme === "light" ? "var(--accent-purple)" : "rgba(var(--tint-rgb),0.15)",
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
            transform: theme === "light" ? `translateX(${width - knob - 4}px)` : "translateX(0)",
          }}
        />
      </button>
      <span aria-hidden="true" style={{ fontSize: iconSize, lineHeight: 1 }}>
        ☀️
      </span>
    </span>
  );
}
