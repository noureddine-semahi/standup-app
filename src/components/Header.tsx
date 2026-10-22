"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getOrCreateProfile,
  updateThemePreference,
  consumePendingReferral,
  listConnections,
  getMyGoalAssignments,
  getMyMentions,
  getMyPostActivityNotifications,
  markConnectionSeen,
  markGoalAssignmentSeen,
  markGoalAssignmentSeenByRecipient,
  markMentionSeen,
  markPostActivityNotificationSeen,
  connectionDisplayName,
  type Profile,
  type Connection,
  type GoalAssignment,
  type Mention,
  type PostActivityNotification,
} from "@/lib/supabase/db";
import { onPointsUpdated } from "@/lib/pointsBus";
import { onNotificationsUpdated, notifyNotificationsUpdated } from "@/lib/notificationsBus";
import { countNotifications, computeNotificationBuckets } from "@/lib/notificationBuckets";
import { getStoredTheme, setTheme } from "@/lib/theme";
import { hexToRgbTriple } from "@/lib/color";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import Avatar from "@/components/Avatar";
import { MoreHorizontal, Bell, LayoutDashboard, Users, CheckCircle2, Sun, Calendar, Wrench, TrendingUp, Info, HelpCircle, Mail } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";

// A profile's theme defaults to "dark" (DB column default), so this can't
// tell "explicitly chosen dark" apart from "never chosen" — but it doesn't
// need to. It only fires when the DB still says the default AND this
// browser's local value says otherwise, which only happens for someone who
// picked light mode before per-account themes existed; that one-time nudge
// carries their existing choice into their profile instead of discarding it.
function applyAccountTheme(p: Profile) {
  if (p.theme === "dark" && getStoredTheme() === "light") {
    setTheme("light");
    updateThemePreference("light").catch(() => {});
  } else {
    setTheme(p.theme);
  }
}

// Still used by infoLinks() below for logged-out visitors only — they
// never see NAV_TABS (none of its routes work without an account), so
// this space-saving rotation is their only way to reach About/FAQ/
// Contact from the header row. A logged-in user reaches the same three
// pages via NAV_TABS instead.
const INFO_ROTATION: Record<string, { labelKey: TranslationKey; href: string }> = {
  "/about": { labelKey: "nav.faq", href: "/faq" },
  "/faq": { labelKey: "nav.contact", href: "/contact" },
  "/contact": { labelKey: "nav.about", href: "/about" },
};
const INFO_PAGES = Object.keys(INFO_ROTATION);

// Every destination the header used to split across the primary row, the
// Assignments icon shortcut, and the About/FAQ/Contact rotation hidden
// behind "More" — these seven now live as their own tab in the hanging
// row below the header (navTabs()), each with its own accent color,
// same folder-tab theme as Social/Tools' own tab bars but inverted
// (hangs down, rounded-bottom, merges upward into the header instead of
// downward into a content panel) — explicit user call, applies to every
// breakpoint (icon-only below 661px, same as the other two folder-tab
// bars). About/FAQ/Contact (the former infoGroup trio, plus the
// `infoGroup` field and the combined-tab mobile stand-in that collapsed
// them into one slot) were removed from this list entirely per a later
// follow-up — see the comment at the end of this array.
const NAV_TABS: { href: string; labelKey: TranslationKey; icon: typeof LayoutDashboard; color: string }[] = [
  { href: "/standup/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, color: "#60a5fa" },
  { href: "/standup/social", labelKey: "nav.social", icon: Users, color: "#a78bfa" },
  { href: "/standup/today", labelKey: "nav.reviewToday", icon: CheckCircle2, color: "#34d399" },
  { href: "/standup/tomorrow", labelKey: "nav.planTomorrow", icon: Sun, color: "#f59e0b" },
  { href: "/standup/calendar", labelKey: "nav.calendar", icon: Calendar, color: "#22d3ee" },
  { href: "/standup/history", labelKey: "nav.progressInsights", icon: TrendingUp, color: "#818cf8" },
  { href: "/standup/tools", labelKey: "nav.tools", icon: Wrench, color: "#f43f5e" },
  // Goal Assignments removed from here per explicit follow-up — still
  // reachable via Social's Goals tab and Tools' Assignments tab, same as
  // before this whole nav restructure ever started.
  // About/FAQ/Contact (the former infoGroup) removed from THIS array
  // (and therefore from the hanging tab row, navTabs()) per an earlier
  // follow-up -- still true today, the hanging row stays at its existing
  // 7 destinations. INFO_ROTATION/INFO_PAGES/infoLinks() below are
  // untouched -- still used by logged-out visitors' own nav.
];

// Re-added to the signed-in DROPDOWN/menu panel only (hamburgerNavLinks()
// below, shared by the desktop hamburger's floating panel and the mobile
// logo-trigger's docked panel) per an explicit later follow-up -- NOT to
// NAV_TABS/navTabs()'s hanging row, which stays at its existing 7 items.
// Kept as a separate array (not merged into NAV_TABS) specifically so
// that distinction is structural, not just a filter someone could drop
// by accident. Same labelKeys infoLinks()/INFO_ROTATION already use for
// the logged-out nav, so EN/ES copy stays identical for both audiences.
const INFO_NAV_ITEMS: { href: string; labelKey: TranslationKey; icon: typeof LayoutDashboard; color: string }[] = [
  { href: "/about", labelKey: "nav.about", icon: Info, color: "#94a3b8" },
  { href: "/faq", labelKey: "nav.faq", icon: HelpCircle, color: "#fbbf24" },
  { href: "/contact", labelKey: "nav.contact", icon: Mail, color: "#fb7185" },
];

// Header glass date/time widget -- fixed, uppercase, English-abbreviation
// tokens (OCT/TUE), not run through t()/i18n: the design spec calls for
// this exact chronograph-style format regardless of the app's current
// language, the same way "AM"/"PM" or a priority chip's "P3" aren't
// translated either. FULL_* are only ever used to build the accessible
// aria-label (see headerDateTime() below), never rendered visually.
const DATETIME_MONTHS_SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DATETIME_WEEKDAYS_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DATETIME_MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DATETIME_WEEKDAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLanguage();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  // Raw data behind notificationCount -- kept around (not just the
  // tally) so the bell's own dropdown can render actual rows instead of
  // re-fetching everything again on open.
  const [connections, setConnections] = useState<Connection[]>([]);
  const [goalAssignments, setGoalAssignments] = useState<GoalAssignment[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [postActivity, setPostActivity] = useState<PostActivityNotification[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  // Header Navigation Refresh: the account dropdown (Profile/Theme/
  // Language/Logout) that replaces the old plain avatar Link. One
  // shared open flag, same as every other header dropdown here --
  // desktop and mobile each render their own trigger+panel pair (see
  // profileMenu() below) since their layout needs genuinely differ
  // (inline pill vs icon-only), but both toggle this same state.
  const [profileOpen, setProfileOpen] = useState(false);
  // Entries clicked from the bell dropdown this session, hidden from it
  // immediately rather than waiting on a refetch round-trip -- for the
  // four bucket types with a real seen_at (mentions, post activity,
  // resolved connections/assignments, canceled-for-recipient) the click
  // also calls the matching mark-seen RPC, so the dismissal is real and
  // persists; for the three still-pending/actionable buckets (a
  // connection request, a received/sent goal assignment awaiting a
  // decision) there's no "seen" concept to persist -- those stay on
  // Dashboard and in the badge count until actually resolved, this only
  // stops the dropdown itself from re-showing something already looked at.
  const [dismissedEntryIds, setDismissedEntryIds] = useState<Set<string>>(new Set());
  const moreRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  // Header Navigation Refresh: the hamburger's NEW desktop instance is a
  // real floating dropdown (unlike the existing mobile panel, which is a
  // full-width block below the header and has never needed click-outside
  // detection) -- this wraps its trigger button AND its panel together,
  // same shape as moreRef/bellRef above, so a click on the trigger itself
  // is never mistaken for an "outside" click. hamburgerMobileBtnRef wraps
  // only the mobile trigger button (not its panel) for the same reason --
  // without it, a tap on the mobile button would be seen as "outside"
  // hamburgerDesktopRef and race against the button's own toggle.
  const hamburgerDesktopRef = useRef<HTMLDivElement>(null);
  const hamburgerMobileBtnRef = useRef<HTMLButtonElement>(null);
  // ROOT CAUSE (mobile hamburger nav bug): the mousedown-based outside-
  // click effect below is a single document-wide listener -- it was
  // written assuming only the NEW desktop dropdown needed it ("the
  // existing mobile panel... has never had click-outside-to-close"), but
  // that listener isn't actually scoped to desktop; it runs for every
  // tap everywhere. Without the mobile panel's own content wrapped in a
  // ref it recognizes as "inside," a tap on ANY mobile nav item reads as
  // an outside click -- mousedown fires before click on touch devices,
  // so setMenuOpen(false) unmounts the tapped <Link> a beat before its
  // own click/onClick can ever run, silently eating the navigation. This
  // wraps the mobile panel's actual content (not just its outer
  // conditional wrapper) so the effect recognizes a tap inside it as
  // genuinely "inside."
  const mobileMenuPanelRef = useRef<HTMLDivElement>(null);
  // Profile is a real floating dropdown at BOTH breakpoints (unlike
  // hamburger's mobile variant), so each of its two trigger+panel pairs
  // gets its own ref, both checked together in one click-outside effect.
  const profileDesktopRef = useRef<HTMLDivElement>(null);
  const profileMobileRef = useRef<HTMLDivElement>(null);
  // Global Header Nav auto-fit: refs on the logo and the end-cluster
  // (hamburger/bell/profile) so the hanging tab row below can measure
  // their REAL rendered edges instead of guessing a fixed clearance --
  // see the ResizeObserver effect further below and
  // .folder-tabbar-hanging's padding-left/padding-right in globals.css,
  // which consume the CSS custom properties that effect sets.
  const brandRef = useRef<HTMLAnchorElement>(null);
  // Mobile header amendment: the logo has two real DOM instances now
  // (brandRef's desktop <Link>, hidden below 761px; this mobile <button>,
  // hidden above 760px) -- same dual-render-plus-CSS-visibility pattern
  // this app already uses elsewhere (e.g. .today-command-bar-desktop/
  // -mobile) for "genuinely different element/semantics per breakpoint,"
  // not just a visual swap. updateNavLayout()'s effect below picks
  // whichever one is actually visible when measuring the tab row's left
  // clearance.
  const brandMobileRef = useRef<HTMLButtonElement>(null);
  const navEndClusterRef = useRef<HTMLDivElement>(null);
  // Header glass date/time widget -- `clockNow` starts null (not
  // `new Date()`) specifically so the FIRST render, server and client
  // alike, produces identical markup (the placeholder branch in
  // headerDateTime() below) -- a server has no notion of the visitor's
  // LOCAL time, so rendering a real time on the server would either be
  // wrong (server's own timezone) or mismatch whatever the client
  // hydrates with. The real clock only ever appears after the mount
  // effect below runs client-side, same guarded pattern this app's
  // other client-only-safe pieces already use elsewhere.
  const [clockNow, setClockNow] = useState<Date | null>(null);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
      // Signed-out visitors always see dark by default — reset here rather
      // than leaving whatever this account had chosen.
      setTheme("dark");
      // A full reload (not router.push) so the fresh page load reads the
      // now-cleared session from scratch — client-side navigation right
      // after signOut() could still see the stale in-memory session for a
      // moment and bounce back to the dashboard, which is what made logout
      // look like it "didn't work" until a second click.
      window.location.href = "/";
    } catch (error) {
      console.error("Logout error:", error);
      setLoggingOut(false);
    }
  }

  // Header Navigation Refresh: the ONE place that opens/closes any of the
  // four header dropdowns (hamburger, bell, More, profile) -- guarantees
  // "opening one closes the others" by construction (every toggle call
  // sets all four in one go) rather than relying on each button's own
  // onClick to remember to close the other three.
  function toggleMenu(target: "menu" | "bell" | "more" | "profile") {
    setMenuOpen((v) => (target === "menu" ? !v : false));
    setBellOpen((v) => (target === "bell" ? !v : false));
    setMoreOpen((v) => (target === "more" ? !v : false));
    setProfileOpen((v) => (target === "profile" ? !v : false));
  }

  useEffect(() => {
    async function loadUser() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user) {
          setUser(session.user);
          consumePendingReferral().catch(() => {});

          try {
            const p = await getOrCreateProfile();
            setProfile(p);
            applyAccountTheme(p);
          } catch {
            // ignore if profile fails
          }
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (error) {
        console.error("Error loading user:", error);
      } finally {
        setLoading(false);
      }
    }

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        consumePendingReferral().catch(() => {});
        getOrCreateProfile()
          .then((p) => {
            setProfile(p);
            applyAccountTheme(p);
          })
          .catch(() => {});
      } else {
        setUser(null);
        setProfile(null);
      }
    });

    const unsubscribePoints = onPointsUpdated(() => {
      getOrCreateProfile()
        .then((p) => setProfile(p))
        .catch(() => {});
    });

    return () => {
      subscription.unsubscribe();
      unsubscribePoints();
    };
  }, []);

  // Any navigation (a hamburger/More/profile link, desktop or mobile)
  // closes every header dropdown, so none of them stay open across a
  // page change. Consolidated from two previously-separate effects
  // (this one plus bellOpen's own below) now that there are four
  // dropdowns needing the exact same treatment instead of two.
  useEffect(() => {
    setMenuOpen(false);
    setMoreOpen(false);
    setBellOpen(false);
    setProfileOpen(false);
  }, [pathname]);

  // The header stays mounted across client-side navigation (it lives in
  // the root layout, not per-page), so its notification count needs its
  // own refresh triggers rather than a plain mount-only fetch: the
  // notificationsBus event (fired by whatever action actually changed a
  // count — Social/Today/Tomorrow/Dashboard) is the primary one, and a
  // refetch on every pathname change is a cheap safety net for any action
  // this session didn't get around to wiring up explicitly.
  function refreshNotificationCount() {
    if (!user) return;
    Promise.all([
      listConnections(),
      getMyGoalAssignments(),
      getMyMentions().catch(() => []),
      getMyPostActivityNotifications().catch(() => []),
    ])
      .then(([conns, assignments, newMentions, newPostActivity]) => {
        setConnections(conns);
        setGoalAssignments(assignments);
        setMentions(newMentions);
        setPostActivity(newPostActivity);
        setNotificationCount(countNotifications(conns, assignments, newMentions, newPostActivity));
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (!user) {
      setNotificationCount(0);
      return;
    }
    refreshNotificationCount();
    return onNotificationsUpdated(refreshNotificationCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    refreshNotificationCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // The "More" panel floats over the page rather than pushing content down
  // (unlike the full-width mobile dropdown), so it needs an explicit
  // click-outside to close — otherwise it'd stay open until another nav
  // link was clicked.
  useEffect(() => {
    if (!moreOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [moreOpen]);

  // Same click-outside treatment as the More panel above.
  useEffect(() => {
    if (!bellOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [bellOpen]);

  // This mousedown listener is document-wide, not desktop-scoped, despite
  // originally being written only with the new desktop dropdown in mind
  // -- see mobileMenuPanelRef's own comment above for the bug this caused
  // on mobile and why its ref is now checked here too. hamburgerMobileBtnRef
  // is checked too (not just hamburgerDesktopRef) so a tap on the MOBILE
  // trigger button is never mistaken for an outside click and raced
  // against that button's own toggle -- the three refs are never all
  // relevant at the same breakpoint, but checking all of them is harmless.
  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const insideDesktop = hamburgerDesktopRef.current?.contains(target) ?? false;
      const insideMobileBtn = hamburgerMobileBtnRef.current?.contains(target) ?? false;
      const insideMobilePanel = mobileMenuPanelRef.current?.contains(target) ?? false;
      if (!insideDesktop && !insideMobileBtn && !insideMobilePanel) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  // Profile is a real floating dropdown at BOTH breakpoints (unlike
  // hamburger), so both of its trigger+panel pairs need this -- each ref
  // wraps its own button AND panel together (same shape as moreRef/
  // bellRef above), so clicking either trigger is never mistaken for an
  // outside click.
  useEffect(() => {
    if (!profileOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const insideDesktop = profileDesktopRef.current?.contains(target) ?? false;
      const insideMobile = profileMobileRef.current?.contains(target) ?? false;
      if (!insideDesktop && !insideMobile) setProfileOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profileOpen]);

  // Mobile header amendment, section C: Escape closes whichever of the
  // four header dropdowns is open, moving focus back to the control
  // that opened it -- this didn't exist for ANY of them before (the
  // old hamburger/bell/More/profile triggers only ever had outside-
  // click-to-close, confirmed by grepping this file for "Escape"/
  // "keydown" before this effect existed), but keyboard Escape-to-
  // close is exactly the "canonical...Escape behavior/focus
  // management" the mobile menu's new logo trigger needs, so this adds
  // it once for the shared menuOpen/bellOpen/moreOpen/profileOpen
  // state rather than wiring something bespoke onto only the new
  // trigger. Moving focus back (not just closing) matters most for the
  // mobile case specifically: without it, focus would be left on a
  // mobile-menu link that just disappeared, stranding keyboard/screen-
  // reader navigation with no clear next focus target.
  useEffect(() => {
    if (!menuOpen && !bellOpen && !moreOpen && !profileOpen) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (menuOpen) {
        setMenuOpen(false);
        (hamburgerDesktopRef.current?.querySelector("button") ?? hamburgerMobileBtnRef.current)?.focus();
      }
      if (bellOpen) {
        setBellOpen(false);
        bellRef.current?.querySelector("button")?.focus();
      }
      if (moreOpen) {
        setMoreOpen(false);
        moreRef.current?.querySelector("button")?.focus();
      }
      if (profileOpen) {
        setProfileOpen(false);
        (profileDesktopRef.current?.querySelector("button") ?? profileMobileRef.current?.querySelector("button"))?.focus();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [menuOpen, bellOpen, moreOpen, profileOpen]);

  // Keeps the newly-active hanging tab centered in the scrollable nav
  // strip whenever the route changes -- explicit user call, otherwise
  // navigating to a tab near either end can leave it partially (or
  // fully) off-screen on narrow viewports with nothing prompting the
  // user to scroll there themselves.
  useEffect(() => {
    const active = document.querySelector(".folder-tab-hanging-active");
    active?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [pathname]);

  // Header glass date/time widget -- ticks to the START of the NEXT
  // local minute (setTimeout with a computed delay), not a 1s
  // setInterval, since seconds are never displayed: re-rendering this
  // (and therefore the whole Header tree, which lives in the root
  // layout) 60x more often than the visible text could ever change
  // would be pure waste. A single scheduled timeout re-arms itself
  // after each tick rather than using setInterval, so drift can't
  // accumulate across ticks. new Date() at each tick naturally carries
  // every rollover this needs (minute/hour/day/month/weekday) --
  // nothing else has to special-case midnight or month-end. Runs
  // client-only (mount-only effect): first tick also happens here, not
  // at declaration time, so the server/first-client-render both stay on
  // the null placeholder (see clockNow's own comment above) and only
  // diverge after this effect fires, same timing hydration already
  // tolerates for any other post-mount state update.
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    function tick() {
      const n = new Date();
      setClockNow(n);
      const msUntilNextMinute = (60 - n.getSeconds()) * 1000 - n.getMilliseconds();
      timeoutId = setTimeout(tick, Math.max(1000, msUntilNextMinute));
    }
    tick();
    return () => clearTimeout(timeoutId);
  }, []);

  // Global Header Nav auto-fit: measures the logo's and the end-cluster's
  // REAL rendered edges (brandRef/navEndClusterRef above) and exposes them
  // as CSS custom properties the hanging tab row's own padding-left/
  // padding-right consume (see .folder-tabbar-hanging in globals.css) --
  // replaces a guessed, per-breakpoint fixed clearance with the tab row
  // actually starting right where the logo ends and extending right up
  // to where the end-cluster begins, at every width. This matters most
  // for the right side: the desktop profile pill's own width varies with
  // the signed-in user's display name length (see profileMenu() below),
  // so no single fixed pixel guess could ever be correct for everyone.
  // Also solves for the exact per-tab horizontal padding that makes
  // every tab's full icon+label fit inside that now-accurately-known
  // width -- see updateNavLayout's own comment below for why this
  // replaced a guessed CSS clamp() formula.
  // ResizeObserver (not just a resize listener) also catches the
  // end-cluster's own width changing independent of the viewport -- e.g.
  // the hamburger/profile dropdown mounting doesn't change this, but a
  // future addition to that cluster would be picked up automatically
  // without needing a new hardcoded number here. The CSS var()s this
  // writes keep the original fixed per-breakpoint values as their own
  // fallback (see globals.css), so there's no flash of an unconstrained
  // row before this effect's first run, and nothing breaks if JS is
  // unavailable.
  useEffect(() => {
    const header = document.querySelector(".app-header") as HTMLElement | null;
    if (!header) return;

    // After setting the measured left/right clearance, also measures
    // actual overflow (row.scrollWidth vs its now-correctly-bounded
    // clientWidth) and solves for the exact per-tab horizontal padding
    // that makes it fit -- real DOM measurement rather than a guessed
    // CSS clamp() formula, which proved inaccurate in practice (it was
    // tuned against estimated label widths and a since-corrected
    // assumption about how much room the right side actually had).
    // --nav-tab-h-padding is reset to the full/comfortable value before
    // each measurement so widening the window can always recover full
    // spacing, not stay stuck compressed from a prior narrower width.
    // The relationship between padding and total row width is linear
    // (each tab contributes the same padding twice), so one
    // measure-and-solve pass lands on the right value directly, no
    // iteration needed. Reading scrollWidth/clientWidth right after the
    // style change forces a synchronous layout flush -- acceptable
    // here since this only runs on resize/mount/relevant state changes,
    // not on every render. .folder-tab-hanging's own CSS clamp()
    // formula (globals.css) remains this custom property's fallback,
    // so the row still degrades gracefully before this effect's first
    // run and if JS is ever unavailable.
    function updateNavLayout() {
      // Mobile header amendment: brandRef (desktop <Link>) and
      // brandMobileRef (mobile <button>) are mutually exclusive via CSS
      // display:none, so exactly one ever has a real, non-zero rect at
      // a given width -- getComputedStyle, not an innerWidth breakpoint
      // guess, so this always matches whatever the CSS actually decided.
      const brandDesktopVisible = brandRef.current && getComputedStyle(brandRef.current).display !== "none";
      const activeBrand = brandDesktopVisible ? brandRef.current : brandMobileRef.current;
      // Mobile header amendment: .nav-end-cluster itself is now
      // display:none on mobile (not just its children, see globals.css)
      // to stop it consuming an empty flex-item slot/gap pair next to
      // the real visible cluster -- so its own rect is a zero-rect at
      // mobile widths now, same reason brandRef's desktop instance is.
      // document.querySelector here (not a new ref) matches this same
      // function's existing .folder-tabbar-hanging lookup below, not a
      // new pattern.
      const mobileTriggerEl = document.querySelector(".nav-mobile-trigger") as HTMLElement | null;
      const endClusterVisible = navEndClusterRef.current && getComputedStyle(navEndClusterRef.current).display !== "none";
      const activeEnd = endClusterVisible ? navEndClusterRef.current : mobileTriggerEl;
      if (!header || !activeBrand || !activeEnd) return;
      const brandRect = activeBrand.getBoundingClientRect();
      const endRect = activeEnd.getBoundingClientRect();
      // Anchored to the logo's own LEFT edge (where it starts), not its
      // right edge (where it ends) -- explicit user call: the first tab
      // (Dashboard) sits directly under the logo's start, not pushed
      // right past it, reclaiming the large clearance gap that used to
      // sit empty between them. The oversized logo image does dip down
      // slightly into this row (see .brand-oversized in globals.css),
      // but only touches the very top sliver of the first tab's own
      // padding, not its label -- an explicit, accepted tradeoff here,
      // not an oversight.
      const left = Math.max(0, Math.round(brandRect.left));
      const right = Math.max(0, Math.round(window.innerWidth - endRect.left));
      header.style.setProperty("--nav-tab-left-clearance", `${left}px`);
      header.style.setProperty("--nav-tab-right-clearance", `${right}px`);
      header.style.setProperty("--nav-tab-h-padding", "16px");

      const row = document.querySelector(".folder-tabbar-hanging") as HTMLElement | null;
      if (!row) return;
      const overflow = row.scrollWidth - row.clientWidth;
      if (overflow <= 0) return;

      const tabs = row.querySelectorAll(".folder-tab-hanging").length;
      if (tabs === 0) return;
      const reductionPerSide = overflow / (tabs * 2);
      const nextPadding = Math.max(2, 16 - reductionPerSide);
      header.style.setProperty("--nav-tab-h-padding", `${nextPadding}px`);
    }

    updateNavLayout();
    window.addEventListener("resize", updateNavLayout);

    // Deliberately does NOT observe the tab row itself -- this effect is
    // what changes its size (via --nav-tab-h-padding), so watching it
    // too would risk a resize-observer feedback loop. brandRef/
    // brandMobileRef/navEndClusterRef are never mutated by this effect,
    // so observing them is safe. Both brand instances are observed
    // (only one is ever visible at a time, but ResizeObserver on a
    // display:none element is harmless) so a width change crossing the
    // 760px breakpoint itself is also picked up, not just same-tier
    // resizes.
    const ro = new ResizeObserver(updateNavLayout);
    if (brandRef.current) ro.observe(brandRef.current);
    if (brandMobileRef.current) ro.observe(brandMobileRef.current);
    if (navEndClusterRef.current) ro.observe(navEndClusterRef.current);
    const mobileTriggerElForObserver = document.querySelector(".nav-mobile-trigger");
    if (mobileTriggerElForObserver) ro.observe(mobileTriggerElForObserver);

    return () => {
      window.removeEventListener("resize", updateNavLayout);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile, loading, pathname]);

  type NotificationEntry = {
    id: string;
    label: string;
    sublabel?: string;
    href: string;
    // null for the three still-pending/actionable buckets, which have no
    // seen_at to persist -- see the dismissedEntryIds comment above.
    markSeen: (() => Promise<void>) | null;
  };

  // Flattens the same eight "needs your attention" buckets Dashboard's
  // PendingNotifications renders into one read-only, click-to-jump list
  // for the bell dropdown -- no accept/decline/acknowledge actions here
  // (that stays Dashboard's job), just "what's new" + where to see it.
  // Clicking a row still acknowledges it (see handleEntryClick below),
  // it just does so via the same mark-seen RPC Dashboard's "Got it"
  // button calls, not a dedicated dropdown action.
  function buildNotificationEntries(): NotificationEntry[] {
    const {
      pendingConnections,
      pendingAssignments,
      pendingAssignedByYou,
      resolvedConnections,
      resolvedAssignments,
      canceledForRecipient,
      unseenMentions,
      unseenPostActivity,
    } = computeNotificationBuckets(connections, goalAssignments, mentions, postActivity);

    const entries: NotificationEntry[] = [];

    pendingConnections.forEach((c) =>
      entries.push({
        id: `pconn-${c.id}`,
        label: connectionDisplayName(c, t),
        sublabel: t("dashboard.connectionRequestLabel"),
        href: "/standup/social?tab=friends",
        markSeen: null,
      })
    );
    pendingAssignments.forEach((a) =>
      entries.push({
        id: `pasg-${a.id}`,
        label: a.snapshotTitle,
        sublabel: t("social.assignedByLabel", { name: a.assignerDisplayName ?? t("social.anonymousUser") }),
        href: "/standup/assignments",
        markSeen: null,
      })
    );
    pendingAssignedByYou.forEach((a) =>
      entries.push({
        id: `pasgby-${a.id}`,
        label: a.snapshotTitle,
        sublabel: t("dashboard.assignmentWaitingStatus", { name: a.recipientDisplayName ?? t("social.anonymousUser") }),
        href: "/standup/assignments",
        markSeen: null,
      })
    );
    resolvedConnections.forEach((c) =>
      entries.push({
        id: `rconn-${c.id}`,
        label: connectionDisplayName(c, t),
        sublabel: c.status === "accepted" ? t("dashboard.connectionAcceptedStatus") : t("dashboard.connectionDeclinedStatus"),
        href: "/standup/social?tab=friends",
        markSeen: () => markConnectionSeen(c.id),
      })
    );
    resolvedAssignments.forEach((a) =>
      entries.push({
        id: `rasg-${a.id}`,
        label: a.snapshotTitle,
        sublabel: t("social.assignedToLabel", { name: a.recipientDisplayName ?? t("social.anonymousUser") }),
        href: "/standup/assignments",
        markSeen: () => markGoalAssignmentSeen(a.id),
      })
    );
    canceledForRecipient.forEach((a) =>
      entries.push({
        id: `casg-${a.id}`,
        label: a.snapshotTitle,
        sublabel: t("dashboard.assignmentCanceledForYouLabel", { name: a.assignerDisplayName ?? t("social.anonymousUser") }),
        href: "/standup/assignments",
        markSeen: () => markGoalAssignmentSeenByRecipient(a.id),
      })
    );
    unseenMentions.forEach((m) =>
      entries.push({
        id: `men-${m.id}`,
        label: t("dashboard.mentionLabel", { name: m.mentionedByDisplayName ?? t("social.anonymousUser") }),
        sublabel: m.preview ?? undefined,
        href: `/standup/social?tab=myFeed&post=${m.postId}${m.commentId ? `&comment=${m.commentId}` : ""}`,
        markSeen: () => markMentionSeen(m.id),
      })
    );
    unseenPostActivity.forEach((p) => {
      const labelKey: TranslationKey =
        p.activityType === "comment"
          ? "dashboard.postCommentLabel"
          : p.activityType === "reply"
          ? "dashboard.postReplyLabel"
          : p.activityType === "post_reaction"
          ? "dashboard.postReactionLabel"
          : "dashboard.commentReactionLabel";
      entries.push({
        id: `pa-${p.id}`,
        label: t(labelKey, { name: p.actorDisplayName ?? t("social.anonymousUser") }),
        sublabel: p.preview ?? undefined,
        href: `/standup/social?tab=myFeed&post=${p.postId}${p.commentId ? `&comment=${p.commentId}` : ""}`,
        markSeen: () => markPostActivityNotificationSeen(p.id),
      });
    });

    return entries;
  }

  // Clicking a row acknowledges it immediately (hidden from this
  // dropdown right away, not waiting on a refetch) and, for the four
  // bucket types that have one, persists that via the real mark-seen
  // RPC -- the same action Dashboard's "Got it" button performs, just
  // triggered by following the link instead of a dedicated button.
  function handleEntryClick(entry: NotificationEntry) {
    setDismissedEntryIds((prev) => new Set(prev).add(entry.id));
    setBellOpen(false);
    if (entry.markSeen) {
      entry
        .markSeen()
        .then(() => {
          notifyNotificationsUpdated();
        })
        .catch(() => {
          // Best-effort -- worst case it just reappears next refresh,
          // same fallback every other mark-seen call site in this app
          // already accepts.
        });
    }
  }

  const isAuthPage = pathname === "/login" || pathname === "/signup";
  const isRecoveryPage = pathname === "/reset-password";

  // Rendered once for the desktop row and once for the mobile dropdown, so
  // the active-page logic lives in one place instead of being duplicated
  // across two layouts. The About/FAQ/Contact rotation exists to save
  // horizontal space in the desktop row — the mobile dropdown is a vertical
  // stack with room to spare, so `expanded` renders all three as separate
  // links there instead of the single rotating slot.
  function infoLinks(expanded: boolean) {
    if (!expanded) {
      return (
        <Link
          href={INFO_ROTATION[pathname]?.href ?? "/about"}
          className={INFO_PAGES.includes(pathname) ? "nav-link nav-link-compact font-semibold" : "nav-link nav-link-compact"}
        >
          {t(INFO_ROTATION[pathname]?.labelKey ?? "nav.about")}
        </Link>
      );
    }

    return (
      <>
        <Link href="/about" className={pathname === "/about" ? "nav-link font-semibold" : "nav-link"}>
          {t("nav.about")}
        </Link>
        <Link href="/faq" className={pathname === "/faq" ? "nav-link font-semibold" : "nav-link"}>
          {t("nav.faq")}
        </Link>
        <Link href="/contact" className={pathname === "/contact" ? "nav-link font-semibold" : "nav-link"}>
          {t("nav.contact")}
        </Link>
      </>
    );
  }

  // Logged-out visitors never see NAV_TABS (none of those six routes are
  // reachable without an account) — this is what used to be primaryLinks'
  // other branch, kept as its own small function now that the
  // authenticated case moved to navTabs() below.
  function authLinks() {
    if (loading || user || isAuthPage) return null;
    // Compact now instead of each link stretching via .nav-link's own
    // flex:1 1 130px (fine when they're sharing a row with other grown
    // nav chips, but the only two things left in this row for a signed-
    // out visitor, which made them stretch to fill almost the entire
    // header) -- explicit user call. The info-page rotation (About/FAQ/
    // Contact) moves inline here too instead of being reachable only via
    // the "More" button, and Sign Up becomes the highlighted CTA.
    return (
      <div className="nav-auth-links">
        {infoLinks(false)}
        <Link
          href="/login"
          className={pathname === "/login" ? "nav-link nav-link-compact font-semibold" : "nav-link nav-link-compact"}
        >
          {t("nav.signIn")}
        </Link>
        <Link href="/signup" className="nav-link nav-link-cta">
          {t("landing.getStarted")}
        </Link>
      </div>
    );
  }

  // The hanging tab row below the main header — same folder-tab theme as
  // Social/Tools (see .folder-tab-hanging* in globals.css), inverted to
  // hang down and merge upward into the header instead of down into a
  // content panel. Lives inside the same sticky <header>, so it scrolls
  // with it automatically rather than needing its own sticky offset.
  function navTabs() {
    if (!user) return null;
    return (
      <nav className="folder-tabbar-hanging" aria-label={t("nav.dashboard")}>
        {NAV_TABS.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={`folder-tab-hanging${isActive ? " folder-tab-hanging-active" : ""}`}
              style={{ "--tab-color": tab.color, "--tab-color-rgb": hexToRgbTriple(tab.color) } as React.CSSProperties}
            >
              <tab.icon size={15} />
              <span>{t(tab.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  // For a logged-in user there's nothing left here but Theme/Language —
  // every nav destination (including About/FAQ/Contact, which used to
  // live in this panel via infoLinks) now lives in navTabs() instead.
  // Logged-out visitors don't get navTabs() at all (none of those routes
  // work without an account), so they still get infoLinks() here, same
  // as before this change.
  function secondaryLinks(expanded: boolean) {
    if (loading) return null;

    if (user) {
      return (
        <div className="flex items-center gap-2 px-3 py-1.5">
          <ThemeToggle size="sm" />
          <LanguageToggle size="sm" />
        </div>
      );
    }

    return infoLinks(expanded);
  }

  // Hamburger-menu tap reliability fix: a hamburger item's own panel
  // (.nav-more-panel / .mobile-menu-panel) unmounts the instant
  // setMenuOpen(false) commits -- that's the SAME element the tap just
  // landed on. Letting the <Link>'s native navigation resolve on its own
  // after that (the previous behavior: no onClick at all, closing left
  // entirely to the [pathname] effect further below) raced an anchor's
  // default navigation against its own DOM node disappearing, which is
  // exactly the class of bug mobile Safari is known to drop navigations
  // for. router.push doesn't depend on the clicked node surviving, so
  // explicitly owning the close+navigate sequence here removes that race
  // entirely -- preventDefault is genuinely necessary so the Link's own
  // default action never ALSO fires alongside router.push (that would be
  // a double navigation, not just a redundant one).
  function handleHamburgerNavClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    e.preventDefault();
    setMenuOpen(false);
    router.push(href);
  }

  // Header Navigation Refresh: the full NAV_TABS list as plain full-text
  // links (icon + label), shared verbatim by the desktop hamburger
  // panel and the mobile hamburger panel. gap-2 is the one thing
  // .nav-link's own CSS doesn't already provide for an icon+text pair
  // (see profileMenu()'s identical need below) -- everything else
  // (flex/center/chip styling) comes from the shared class.
  // Reuses the SAME finalized physical-tab recipe as the header's own
  // hanging nav tabs (.folder-tab-hanging/-active in globals.css)
  // instead of the old flat .nav-link chip -- explicit visual-
  // consistency call. nav-menu-item is a small layout-only class
  // (vertical list sizing) that coexists with folder-tab-hanging's own
  // color/shadow/pressed-face recipe, which is otherwise untouched.
  // --tab-color carries each destination's own existing NAV_TABS accent
  // (already defined, previously only consumed by the hanging tab row
  // itself) into this same CSS the same way navTabs() already does.
  //
  // INFO_NAV_ITEMS (About/FAQ/Contact) renders as a second group below
  // a divider -- explicit follow-up re-adding them to this dropdown/
  // menu panel specifically (NOT to NAV_TABS/navTabs()'s hanging row,
  // which stays unchanged at its existing 7 destinations). Same
  // handleHamburgerNavClick/nav-menu-item/--tab-color treatment as the
  // primary group, just a separate .map() over the separate array, so
  // the two groups stay visually and structurally distinct.
  function hamburgerNavLinks() {
    return (
      <>
        {NAV_TABS.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={`folder-tab-hanging nav-menu-item${isActive ? " folder-tab-hanging-active" : ""}`}
              style={{ "--tab-color": tab.color, "--tab-color-rgb": hexToRgbTriple(tab.color) } as React.CSSProperties}
              onClick={(e) => handleHamburgerNavClick(e, tab.href)}
            >
              <tab.icon size={16} />
              <span>{t(tab.labelKey)}</span>
            </Link>
          );
        })}
        <div className="nav-menu-divider" role="separator" />
        {INFO_NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`folder-tab-hanging nav-menu-item${isActive ? " folder-tab-hanging-active" : ""}`}
              style={{ "--tab-color": item.color, "--tab-color-rgb": hexToRgbTriple(item.color) } as React.CSSProperties}
              onClick={(e) => handleHamburgerNavClick(e, item.href)}
            >
              <item.icon size={16} />
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </>
    );
  }

  // Header Navigation Refresh: the signed-in account dropdown
  // (Profile/Theme/Language/Logout) -- replaces the old plain avatar
  // Link. Desktop and mobile each render their OWN trigger+panel pair
  // (genuinely different layouts: an inline name pill vs an icon-only
  // circle) but both toggle the same profileOpen state and show
  // identical panel contents. Reuses .nav-more-panel's exact floating-
  // dropdown chrome rather than introducing a new panel style.
  //
  // Both instances are always mounted (same as hamburger's two
  // instances) -- the mobile one's entire subtree already hides above
  // 760px via its .nav-mobile-trigger ANCESTOR, but the desktop one had
  // no equivalent: only its trigger button carried a hide-below-760px
  // class (.nav-profile), which left the WRAPPER (and therefore its
  // panel) still mounted and visible on mobile whenever profileOpen was
  // true -- rendering a second, mispositioned panel alongside the
  // correct mobile one. nav-profile-wrap-desktop (CSS) hides the whole
  // wrapper, not just the trigger, closing that gap the same way.
  function profileMenu(variant: "desktop" | "mobile") {
    if (!user) return null;
    const ref = variant === "desktop" ? profileDesktopRef : profileMobileRef;
    const triggerLabel = profileOpen ? t("nav.closeMenu") : t("nav.profileAriaLabel");
    return (
      <div
        className={variant === "desktop" ? "nav-profile-wrap nav-profile-wrap-desktop" : "nav-profile-wrap"}
        ref={ref}
      >
        {variant === "desktop" ? (
          <button
            type="button"
            onClick={() => toggleMenu("profile")}
            aria-label={triggerLabel}
            aria-expanded={profileOpen}
            className={
              pathname === "/standup/profile"
                ? "nav-link nav-profile header-metal-control font-semibold flex items-center gap-2"
                : "nav-link nav-profile header-metal-control flex items-center gap-2"
            }
          >
            <Avatar avatarUrl={profile?.avatar_url} label={profile?.display_name || user.email || "U"} size={22} />
            {profile?.display_name || user.email?.split("@")[0] || t("common.user")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => toggleMenu("profile")}
            aria-label={triggerLabel}
            aria-expanded={profileOpen}
            className="header-metal-control header-metal-control--round"
          >
            <Avatar avatarUrl={profile?.avatar_url} label={profile?.display_name || user.email || "U"} />
          </button>
        )}
        {profileOpen && (
          <div className="nav-more-panel">
            <Link href="/standup/profile" className="nav-link" onClick={() => setProfileOpen(false)}>
              {t("nav.profileAriaLabel")}
            </Link>
            <div className="flex items-center gap-2 px-3 py-1.5">
              <ThemeToggle size="sm" />
              <LanguageToggle size="sm" />
            </div>
            <button type="button" onClick={handleLogout} disabled={loggingOut} className="nav-link nav-link-logout">
              {loggingOut ? t("nav.loggingOut") : t("nav.logout")}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ANIMATED GLASS DATE + TIME WIDGET -- sits between the logo and the
  // hamburger/bell/avatar cluster at every breakpoint (Layout #5 split:
  // a big day-of-month number, an etched glass divider, a stacked
  // month·weekday / time info column, a second etched divider, and the
  // Bell -- see the mobile header amendment's section E/F/H/N for why
  // the Bell now lives here instead of in .nav-mobile-trigger. Signed-
  // in only, same as the controls it sits next to (bell/avatar are all
  // `!user`-gated too) -- a signed-out visitor gets authLinks() in this
  // same header slot instead.
  //
  // The outer shell stays a plain, non-interactive <div> -- NOT an
  // aria-label'd button/group wrapping everything, since it now
  // contains one genuinely interactive child (the Bell link). Only the
  // day/divider/info cluster (the actually-informational part) gets
  // its own aria-label'd wrapper (.standup-header-datetime-dateinfo);
  // the Bell keeps its own independent aria-label from notificationBell
  // ("glass") and is reachable by Tab on its own, same as it always was
  // as a standalone control -- this is what "glass shell itself remains
  // non-interactive... Bell needs its own accessible touch target"
  // means structurally.
  //
  // The Bell renders even in the pre-mount placeholder state below --
  // unlike the day/time text (which needs the client-only mount guard
  // to avoid a server/client time mismatch), the Bell has no such
  // constraint, and "Do NOT hide the Bell" is an explicit requirement,
  // so it's never gated behind clockNow.
  //
  // Three progressive date/time content tiers, purely via CSS
  // (.standup-header-datetime-date-full/-mid, .standup-header-datetime-
  // date's own display:none at the narrowest tier) -- the JS always
  // renders all three pieces, media queries pick which ones are
  // visible, same "render everything, let CSS choose" approach
  // .goal-toolbar-label's own responsive hiding already uses elsewhere
  // in this app. Visible text stays abbreviated at every tier; the full
  // unabbreviated sentence lives only in the dateinfo wrapper's own
  // aria-label, with every visual child marked aria-hidden so a screen
  // reader reads the label once instead of the fragmented abbreviations.
  function headerDateTime() {
    if (!user) return null;
    if (!clockNow) {
      return (
        <div className="standup-header-datetime standup-header-datetime-placeholder">
          <span className="standup-header-datetime-placeholder-box" aria-hidden="true" />
          <span className="standup-header-datetime-bell-chamber">
            <span className="standup-header-datetime-divider standup-header-datetime-divider-bell" aria-hidden="true" />
            {notificationBell("glass")}
          </span>
        </div>
      );
    }

    const dayOfMonth = clockNow.getDate();
    const dayStr = String(dayOfMonth).padStart(2, "0");
    const monthShort = DATETIME_MONTHS_SHORT[clockNow.getMonth()];
    const weekdayShort = DATETIME_WEEKDAYS_SHORT[clockNow.getDay()];

    let hour12 = clockNow.getHours() % 12;
    if (hour12 === 0) hour12 = 12;
    const minuteStr = String(clockNow.getMinutes()).padStart(2, "0");
    const ampm = clockNow.getHours() >= 12 ? "PM" : "AM";
    const timeStr = `${hour12}:${minuteStr} ${ampm}`;

    const accessibleLabel = `${DATETIME_WEEKDAYS_FULL[clockNow.getDay()]}, ${
      DATETIME_MONTHS_FULL[clockNow.getMonth()]
    } ${dayOfMonth}, ${clockNow.getFullYear()}, ${timeStr}`;

    return (
      <div className="standup-header-datetime">
        <span className="standup-header-datetime-sheen" aria-hidden="true" />
        <span className="standup-header-datetime-dateinfo" aria-label={accessibleLabel}>
          <span className="standup-header-datetime-day" aria-hidden="true">
            {dayStr}
          </span>
          <span className="standup-header-datetime-divider" aria-hidden="true" />
          <span className="standup-header-datetime-info" aria-hidden="true">
            <span className="standup-header-datetime-date">
              <span className="standup-header-datetime-date-full">
                {monthShort} · {weekdayShort}
              </span>
              <span className="standup-header-datetime-date-mid">{weekdayShort}</span>
            </span>
            <span className="standup-header-datetime-time">{timeStr}</span>
          </span>
        </span>
        <span className="standup-header-datetime-bell-chamber">
          <span className="standup-header-datetime-divider standup-header-datetime-divider-bell" aria-hidden="true" />
          {notificationBell("glass")}
        </span>
      </div>
    );
  }

  // Always visible regardless of breakpoint (unlike the primary/secondary
  // split) — a pending-notification indicator is exactly the kind of thing
  // that shouldn't disappear into a menu. Rendered right next to
  // profileMenu() now rather than in the utility cluster —
  // explicit user call.
  //
  // Desktop click opens an attached dropdown listing the actual
  // notifications (buildNotificationEntries() above) — explicit user
  // call, each row links straight to the goal/post/comment it's about.
  // Mobile keeps the old plain Link-to-Dashboard behavior instead of also
  // getting the dropdown: Dashboard's PendingNotifications already shows
  // the identical list (plus Accept/Decline/Got it, which this read-only
  // dropdown deliberately doesn't have), and a floating panel has much
  // less room to work with on a phone-width header.
  //
  // "glass" variant (mobile header amendment): the EXACT same mobile
  // Link/href/aria-label/badge as the "mobile" branch below -- this is
  // the canonical mobile bell, not a second implementation -- just
  // without .nav-bell-btn/.header-metal-control's own dark-metal socket
  // styling, since it now lives as the third chamber of the glass
  // date/time instrument (.standup-header-datetime-bell below) and
  // must read as part of ONE continuous piece of glass, not a metal
  // button embedded in one.
  function notificationBell(variant: "desktop" | "mobile" | "glass") {
    if (!user) return null;
    if (variant === "mobile" || variant === "glass") {
      return (
        <Link
          href="/standup/dashboard"
          className={variant === "glass" ? "standup-header-datetime-bell" : "nav-bell-btn header-metal-control"}
          aria-label={t("nav.notificationsAriaLabel")}
        >
          <Bell size={variant === "glass" ? 16 : 18} />
          {notificationCount > 0 && (
            <span className="nav-bell-badge">{notificationCount > 9 ? "9+" : notificationCount}</span>
          )}
        </Link>
      );
    }
    const entries = bellOpen ? buildNotificationEntries().filter((e) => !dismissedEntryIds.has(e.id)) : [];
    return (
      <div className="nav-bell-wrap" ref={bellRef}>
        <button
          type="button"
          className="nav-bell-btn header-metal-control"
          aria-label={bellOpen ? t("nav.closeMenu") : t("nav.notificationsAriaLabel")}
          aria-expanded={bellOpen}
          onClick={() => toggleMenu("bell")}
        >
          <Bell size={18} />
          {notificationCount > 0 && (
            <span className="nav-bell-badge">{notificationCount > 9 ? "9+" : notificationCount}</span>
          )}
        </button>
        {bellOpen && (
          <div className="nav-bell-panel">
            <div className="nav-bell-panel-title">{t("dashboard.notificationsTitle")}</div>
            {entries.length === 0 ? (
              <div className="nav-bell-empty">{t("nav.noNotifications")}</div>
            ) : (
              <div className="nav-bell-list">
                {entries.map((entry) => (
                  <Link key={entry.id} href={entry.href} className="nav-bell-row" onClick={() => handleEntryClick(entry)}>
                    <div className="min-w-0">
                      <div className="nav-bell-row-label">{entry.label}</div>
                      {entry.sublabel && <div className="nav-bell-row-sublabel">{entry.sublabel}</div>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
            <Link href="/standup/dashboard" className="nav-bell-view-all" onClick={() => setBellOpen(false)}>
              {t("nav.viewAllNotifications")}
            </Link>
          </div>
        )}
      </div>
    );
  }

  // Assignments used to need its own persistent shortcut here because the
  // Calendar/Backlog rotation made it too easy to miss entirely — it's now
  // just another NAV_TABS tab, so that workaround is gone too.

  if (isRecoveryPage) {
    return (
      <header className="app-header">
        <div className="app-header-inner">
          <Link href={user ? "/standup/dashboard" : "/"} className="brand brand-oversized">
            {/* Two theme-specific exports, toggled by [data-theme] in CSS
                (see .brand-logo-light/-dark) rather than swapping `src` in
                JS -- the dark-mode export's glow includes a real dark
                ambient-shadow layer (correctly alpha-faded, by design for
                a near-black header) that reads as a visible gray smudge
                on a light one. The light export shrinks that shadow's
                alpha specifically (see standup-wordmark-light.png's
                generation) so it nearly disappears on white instead.
                Same technique as the app's existing data-theme CSS
                pattern elsewhere, no new state/effect needed. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/standup-wordmark.png" alt="StandUp" className="brand-logo brand-logo-dark" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/standup-wordmark-light.png" alt="StandUp" className="brand-logo brand-logo-light" />
          </Link>
        </div>
      </header>
    );
  }

  return (
    <header className="app-header">
      <div className="app-header-inner">
        {/* Desktop/tablet: the logo is a real navigation Link (home/
            dashboard), unchanged. Hidden on mobile (see .brand-desktop-
            only in globals.css) -- the mobile brand button below takes
            its place there instead. */}
        <Link
          href={user ? "/standup/dashboard" : "/"}
          className="brand brand-oversized brand-desktop-only"
          ref={brandRef}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/standup-wordmark.png" alt="StandUp" className="brand-logo brand-logo-dark" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/standup-wordmark-light.png" alt="StandUp" className="brand-logo brand-logo-light" />
        </Link>

        {/* Mobile header amendment: on mobile ONLY, the logo becomes the
            mobile menu trigger instead of a navigation link -- the
            separate hamburger button that used to do this (further
            below) is gone, freeing its width for the glass date/time
            instrument. Reuses the EXACT same canonical menu state/
            handler/outside-click/content as the old mobile hamburger
            (toggleMenu("menu"), menuOpen, hamburgerMobileBtnRef,
            mobileMenuPanelRef, hamburgerNavLinks()/secondaryLinks())
            -- nothing about the menu itself is duplicated or
            reimplemented, only which element triggers it changed. A
            plain <button> (type="button", no href) with the same two
            logo <img> children as the desktop Link and no visible
            button chrome of its own (see .brand-mobile-trigger in
            globals.css -- background/border:none, just a restrained
            press/focus glow) so it still reads as "the StandUp logo,"
            not a rectangular control. Hidden above the mobile
            breakpoint (.brand-mobile-only). */}
        <button
          type="button"
          ref={(el) => {
            // Two refs, one element: brandMobileRef (layout measurement,
            // see updateNavLayout() above) and hamburgerMobileBtnRef
            // (the SAME ref the old mobile hamburger button used for
            // outside-click detection, see the menuOpen effect above --
            // reused as-is, not duplicated, now that this button is
            // mobile's menu trigger instead).
            brandMobileRef.current = el;
            hamburgerMobileBtnRef.current = el;
          }}
          className="brand brand-oversized brand-mobile-only brand-mobile-trigger"
          aria-label={menuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu-panel"
          onClick={() => toggleMenu("menu")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/standup-wordmark.png" alt="StandUp" className="brand-logo brand-logo-dark" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/standup-wordmark-light.png" alt="StandUp" className="brand-logo brand-logo-light" />
        </button>

        {/* Logged-out only — Sign In/Sign Up. Logged-in users get the same
            destinations via navTabs()'s hanging row below instead. */}
        {authLinks()}

        {/* Glass date/time widget — sits in the natural space-between gap
            .app-header-inner's flex layout already leaves between the
            brand and whichever end cluster (desktop or mobile) is
            visible at the current width. Signed-in only (see
            headerDateTime()'s own comment), so it occupies the exact
            same slot authLinks() uses for a signed-out visitor — the
            two are mutually exclusive by construction (each gated on
            opposite sides of the same `user` check), never both
            present at once. */}
        {headerDateTime()}

        {/* Hamburger + Bell + (logged-out only) More + Profile grouped
            together at the very end of the row — explicit user call. A
            shared wrapper (.nav-end-cluster) is what makes this actually
            attached: as separate .app-header-inner children,
            space-between would scatter them apart like any other two
            items in the row instead of treating them as one unit. Hidden
            on true mobile, same as before this restructure, where
            nav-mobile-trigger's compact icon-only cluster takes over
            instead (full text labels don't fit a phone-width row).
            Header Navigation Refresh: the hamburger now has a real
            desktop instance here too (it used to be mobile-only) —
            signed-in users reach the full NAV_TABS list through it
            instead of through "More," which now only ever shows for a
            logged-out visitor (About/FAQ/Contact) since Theme/Language/
            Logout moved into the new profile dropdown below. */}
        <div className="nav-end-cluster" ref={navEndClusterRef}>
          <div className="nav-utility-cluster nav-utility-cluster-desktop">
            {user && (
              <div className="nav-hamburger-wrap" ref={hamburgerDesktopRef}>
                <button
                  type="button"
                  className="hamburger-btn header-metal-control"
                  aria-label={menuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
                  aria-expanded={menuOpen}
                  onClick={() => toggleMenu("menu")}
                >
                  <span className="hamburger-line" />
                  <span className="hamburger-line" />
                  <span className="hamburger-line" />
                </button>
                {menuOpen && <div className="nav-more-panel">{hamburgerNavLinks()}</div>}
              </div>
            )}

            {notificationBell("desktop")}

            {/* Logged-out only now — About/FAQ/Contact. A signed-in user
                has nothing left to show here (Theme/Language/Logout live
                in the profile dropdown, everything else in the hamburger
                above), so this control disappears for them entirely
                rather than staying present with nothing to offer. */}
            {!user && (
              <div className="nav-more-wrap" ref={moreRef}>
                <button
                  type="button"
                  className="nav-more-btn"
                  aria-label={moreOpen ? t("nav.closeMenu") : t("nav.openMenu")}
                  aria-expanded={moreOpen}
                  onClick={() => toggleMenu("more")}
                >
                  <MoreHorizontal size={18} />
                </button>
                {moreOpen && <div className="nav-more-panel">{secondaryLinks(true)}</div>}
              </div>
            )}
          </div>
          {profileMenu("desktop")}
        </div>

        {/* Mobile header amendment: the standalone mobile Hamburger and
            Bell are gone from this cluster -- the logo (above) is now
            the mobile menu trigger, and the Bell now lives as the third
            chamber of the glass date/time instrument (headerDateTime()
            above). Avatar stays independent on the far right, same
            component/handlers as before, just alone in this wrapper
            now instead of sharing it with two other controls. Hidden
            above the mobile breakpoint — see .nav-mobile-trigger. */}
        <div className="nav-mobile-trigger">
          {!loading && profileMenu("mobile")}
        </div>
      </div>

      {navTabs()}

      {menuOpen && (
        <div className="mobile-menu-panel" id="mobile-menu-panel" ref={mobileMenuPanelRef}>
          {/* Header Navigation Refresh: a signed-in user's menu is now
              the full NAV_TABS list (same content as the new desktop
              hamburger instance above) -- Theme/Language/Logout moved
              to the profile dropdown and are deliberately NOT repeated
              here. A logged-out visitor's content is completely
              unchanged: About/FAQ/Contact (via secondaryLinks) plus
              Sign In/Get Started below. */}
          {user ? (
            hamburgerNavLinks()
          ) : (
            <>
              {secondaryLinks(true)}
              {/* Sign In/Get Started live inline in the desktop row (see
                  .nav-auth-links) but collapse in here on mobile instead --
                  explicit user call. */}
              {!loading && !isAuthPage && (
                <>
                  <Link
                    href="/login"
                    className={pathname === "/login" ? "nav-link font-semibold" : "nav-link"}
                  >
                    {t("nav.signIn")}
                  </Link>
                  <Link href="/signup" className="nav-link nav-link-cta">
                    {t("landing.getStarted")}
                  </Link>
                </>
              )}
            </>
          )}
        </div>
      )}
    </header>
  );
}
