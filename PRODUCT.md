# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Individuals building a daily execution/accountability habit. The app is being built toward public launch (beyond the founder and a small circle of testers) — the landing page, sign-up flow, referral system, and admin growth tracking exist specifically to support a growing member base, not just personal use.

## Product Purpose

StandUp turns goals into a daily planning-and-review loop: each evening the user plans at least 3 goals for the next day (at most one marked top priority), and the next day reviews and closes out that plan before being allowed to plan the day after. Success is sustained daily engagement with the loop, reflected in streaks, points, and levels that compound over time.

## Positioning

Two combined mechanisms a plain to-do app or habit tracker doesn't have: (1) forced daily review-before-planning — you can't plan tomorrow until today's plan has been reviewed and closed, making awareness a gate rather than an optional step; and (2) a full accountability layer (points, streaks, levels, achievements) built specifically on top of that review/close action, not on task completion alone.

## Operating Context

A solo daily ritual: typically once in the evening (plan tomorrow) and once during/after the day (review today, close it out). Web app, mobile-friendly (PWA manifest, used primarily on phone browsers), dark-mode-first. Admin and Sys Admin roles manage members, points, and account data through a separate Admin panel; Sys Admins can also grant/revoke roles.

## Capabilities and Constraints

- Daily plan/goal lifecycle: draft → submitted → reviewed/closed. One plan per day, a minimum of 3 goals to submit, at most one Priority-1 goal per plan.
- Points, streaks, levels, and achievements are awarded for planning, awareness (review), and closure. Goals can be "re-attempted" (rescheduled) forward, but a past day itself can never be reviewed retroactively once it has passed — those days are view-only.
- No push notifications or email exist or are planned — every reminder (end-of-day nudge, overdue-day warning) is an in-app banner shown only while the app is open.
- Auth and data run on Supabase (Postgres + RLS). No service-role key is available, so schema/RPC changes are applied by the user directly in the Supabase SQL editor rather than through automated migrations.
- Referral links and native/social sharing exist to support growth. Anonymous landing-page visits and sign-up counts are tracked (deduped per browser, stops once signed in) for growth visibility in the Admin panel.
- No point penalty exists for a missed/unreviewed day by deliberate design decision — a broken streak is considered penalty enough.

## Brand Commitments

Name "StandUp" is final. The existing dark-first visual identity — deep near-black background, a purple-to-blue gradient as the primary accent, glassy card surfaces — has been deliberately built and iterated on; treat it as incumbent design authority to preserve and extend rather than a blank slate, unless the user explicitly asks for a redesign/rebrand. Light mode exists as a secondary, per-profile user-selectable theme, not the primary design target. Icon/logo assets already exist (`/icons/icon-192.png`, `/favicon.png`).

## Evidence on Hand

No real testimonials, case studies, press, or third-party proof exist yet — the product is pre-public-launch. The landing page's dashboard preview numbers ("247 points", "12-day streak", "85% completed") are illustrative placeholders, not real user data; future work must not present them as real evidence.

## Product Principles

- Review before plan — awareness is a gate, not a suggestion.
- One real priority per day (a single P1) — focus over an exhaustive task list.
- No punitive mechanics — a missed day costs streak, never points; recovery stays possible.
- No push/email — every nudge is an in-app banner, shown only while the user is actually looking.
- Public-launch-ready surfaces (landing, signup, sharing, growth tracking) matter as much as the core daily loop itself.

## Accessibility & Inclusion

No formal requirement recorded yet — may be added later.
