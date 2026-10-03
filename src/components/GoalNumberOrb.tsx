// The one reusable goal-number marker -- a 3D metallic hemisphere with
// an amber LED digit (see .goal-number-badge in globals.css for the
// actual visual construction). Every goal list (Today, Tomorrow, Tools,
// the date detail page, and Today's collapsed-done row) renders this
// SAME component for its number marker, regardless of the goal's status
// -- the orb represents goal IDENTITY, not goal STATE, so it must never
// vary by status. There is intentionally no status/variant prop.
export default function GoalNumberOrb({ number }: { number: number }) {
  return (
    <div className="goal-number-badge">
      {/* Separate element from .goal-number-badge itself -- the sphere's
          own `background` is the multi-layer gunmetal gradient; a
          gradient-filled digit (background-clip:text) needs its OWN
          `background`, which would otherwise collide with the sphere's.
          Also what makes the digit explicitly stack above ::before/
          ::after (see .goal-number-badge-digit's z-index in globals.css) --
          a real rendering bug the plain-text version had, not just a
          brightness/weight issue. */}
      <span className="goal-number-badge-digit">{number}</span>
    </div>
  );
}
