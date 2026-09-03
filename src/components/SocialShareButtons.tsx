"use client";

const SHARE_TEXT = "Build consistency and execute daily with StandUp.";

// Ghost-styled links to the platforms' own share-intent URLs — no app SDK,
// no tracking, just a prefilled post pointing back at the site.
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
  const url = typeof window !== "undefined" ? window.location.origin : "";
  const facebookHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  const xHref = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(SHARE_TEXT)}`;
  const linkClass = `btn btn-ghost text-sm px-4 py-2${onPage ? " btn-on-page" : ""}`;

  return (
    <div className={`flex items-center justify-center gap-3 ${className}`}>
      <a href={facebookHref} target="_blank" rel="noopener noreferrer" className={linkClass}>
        Share on Facebook
      </a>
      <a href={xHref} target="_blank" rel="noopener noreferrer" className={linkClass}>
        Share on X
      </a>
    </div>
  );
}
