---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: []
---

## Scope & mode
Landing page (`/`, `src/app/page.tsx`). Mode: Persuade. First surface of the new visual world; establishes the identity every other page inherits.

## Audience / job / constraints
Someone deciding whether to sign up for a daily execution/accountability tool. They need to grasp the mechanism (plan → review → close, gated by awareness) in seconds and feel it's rigorous, not soft. Must preserve: real copy/claims already on the page (no fabricated proof), the Get Started/Learn More actions, the theme picker, StandUp's name.

## Direction contract

THESIS: Refuses the hero+feature-card SaaS template — the visitor's day rendered as glowing LED scoreboard digits, making "daily execution" literal, not a metaphor.

OWN-WORLD: Near-black matte ground. Lit segments in signal red/amber/green mapped onto StandUp's existing status semantics (red=missed, amber=pending, green=closed). Unlit segments render as faint ghost cells — deliberately drawn, never simply absent. Numerals built on a strict eight-cell segment mask; body copy in a clean monospace/LCD-adjacent face for legibility, not literal segments.

STORY: The visitor sees illustrative Points / Streak / Completion tick in as lit LED digits — this is a machine that counts your discipline. The primary action reads as a lit control-panel switch, not a rounded gradient button.

FIRST VIEWPORT: Full-bleed near-black panel. Three large segment-digit readouts (Points / Streak / Completion) hold center stage, ghost segments visible at rest, lighting in on load. Headline set below in the LCD-adjacent mono face. Primary CTA built as a switch-cell that lights amber on hover/focus. Nav reduced to a thin strip with small lit/unlit indicator dots instead of pill links.

FORM: Seven-segment display family (bedside clocks, gas-station price totems, scoreboards, microwave panels) — dealt challenger, seed key a7586433, user-pinned choice (skipped win/lose weighing).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Unresolved
- How far the segment-mask treatment extends into Operate-mode pages (Dashboard/Today/etc.) is a later decision — this brief covers the landing page only.
- No image generation available this session — build is code-led; no comp exists to approve.
