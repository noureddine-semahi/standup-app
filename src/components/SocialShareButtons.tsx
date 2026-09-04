"use client";

import { useState } from "react";

const SHARE_TEXT = "Build consistency and execute daily with StandUp.";

// Hardcoded rather than window.location.origin — shared links need to point
// at the real production site regardless of where the current user happens
// to be viewing the app from (e.g. testing locally over the LAN).
const PRODUCTION_URL = "https://standup-app-two.vercel.app";

// Ghost-styled links to the platforms' own share-intent URLs (Facebook/X),
// plus a native "Share" button that opens the device's own share sheet —
// Messages/SMS, WhatsApp, email, or whatever else is installed — instead of
// being locked to just two platforms. Falls back to a clipboard copy on
// browsers with no Web Share API support (most desktop browsers).
//
// onPage: pass true when this sits directly on the page canvas (not inside
// a .card) — e.g. About's bottom CTA — so the ghost buttons stay visible in
// light mode. Leave false inside a .card (e.g. Contact), which stays dark
// in both themes, so the plain .btn-ghost styling already works there.
export default function SocialShareButtons({
  className = "",
  onPage = false,
}: {
  className?: string;
  onPage?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const facebookHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(PRODUCTION_URL)}`;
  const xHref = `https://twitter.com/intent/tweet?url=${encodeURIComponent(PRODUCTION_URL)}&text=${encodeURIComponent(SHARE_TEXT)}`;
  const linkClass = `btn btn-ghost text-sm px-4 py-2${onPage ? " btn-on-page" : ""}`;

  async function handleNativeShare() {
    const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

    try {
      if (canNativeShare) {
        await navigator.share({ title: "StandUp", text: SHARE_TEXT, url: PRODUCTION_URL });
      } else {
        await navigator.clipboard.writeText(`${SHARE_TEXT} ${PRODUCTION_URL}`);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Share sheet cancelled or clipboard denied — no-op either way.
    }
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={handleNativeShare} className={linkClass}>
          📤 Share
        </button>
        <a href={facebookHref} target="_blank" rel="noopener noreferrer" className={linkClass}>
          Share on Facebook
        </a>
        <a href={xHref} target="_blank" rel="noopener noreferrer" className={linkClass}>
          Share on X
        </a>
      </div>
      {copied && <p className="mt-2 text-center text-xs text-emerald-300">Link copied to clipboard!</p>}
    </div>
  );
}
