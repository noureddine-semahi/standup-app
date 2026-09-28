/**
 * Shared initial-load placeholder for every authenticated app page —
 * replaces each page's old bare `<div className="card">{loading text}</div>`,
 * which was a single line of text with no fixed size, making the page
 * visibly collapse to almost nothing and then snap back out once data
 * arrived (the "page disappears and reappears" complaint). A stable
 * min-height plus a real spinner keeps the layout's vertical weight
 * roughly consistent through the swap; pairing this with `.card-swap-fade`
 * on the real content's own root element (see each page) turns the swap
 * itself into a crossfade instead of a hard cut.
 */
export default function PageLoadingState({ label }: { label: string }) {
  return (
    <div
      className="card card-highlight flex flex-col items-center justify-center gap-3 text-center"
      style={{ minHeight: "280px" }}
    >
      <div className="loading-spinner" />
      <div className="text-sm text-white/60">{label}</div>
    </div>
  );
}
