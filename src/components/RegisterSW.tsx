"use client";

// File: src/components/RegisterSW.tsx
// Drop this in the root layout, once. Registers the service worker
// on mount and quietly does nothing if the browser doesn't support it
// or you're in dev mode with no HTTPS (SW requires a secure context).

import { useEffect } from "react";

export default function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => {
        // Non-fatal: app works fine without the SW, just no offline page.
        console.warn("Service worker registration failed:", err);
      });
  }, []);

  return null;
}
