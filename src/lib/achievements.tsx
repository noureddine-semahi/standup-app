import {
  Sprout, Sparkles, Flag, Flame, Dumbbell, Trophy, Crown, Orbit, PartyPopper,
  CheckCircle2, Target, Rocket, Shield, Mountain, Percent, Award, Star, Medal, Gem, Diamond,
  Repeat, Search, ListChecks, Handshake, Globe, Megaphone, type LucideIcon,
} from "lucide-react";
import type { TranslationKey } from "@/lib/i18n/en";

export type AchievementStats = {
  longestStreak: number;
  totalDaysClosed: number;
  totalGoalsCompleted: number;
  totalPoints: number;
  maxGoalsCompletedInDay: number;
  totalReferrals: number;
  hasShared: boolean;
  reschedulesCompleted: number;
  trackedGoalsCompleted: number;
};

// titleKey/descriptionKey are translation keys, not literal text — this is
// a plain data file outside React with no way to know the current language
// on its own, so every consumer (Profile, AchievementUnlockedModal) calls
// t(a.titleKey)/t(a.descriptionKey) itself.
export type AchievementDef = {
  id: string;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
  // One accent per achievement FAMILY (streak/goals/points/recovery/social),
  // reusing hues the app already assigns meaning to elsewhere (status/accent
  // tokens in globals.css) rather than inventing a new palette. Every badge
  // rendering uniform green regardless of type — its only prior state — is
  // what made a 26-badge grid hard to tell apart at a glance once emoji
  // (each inherently distinct and colorful) were replaced with monochrome
  // line icons.
  color: string;
  isUnlocked: (stats: AchievementStats) => boolean;
};

const STREAK_COLOR = "#f59e0b"; // amber -- matches --accent-amber
const GOALS_COLOR = "#10b981"; // emerald -- matches --accent-emerald / --status-completed family
const POINTS_COLOR = "#a855f7"; // purple -- matches --status-postponed family
const RECOVERY_COLOR = "#3b82f6"; // blue -- matches --status-in-progress family
const SOCIAL_COLOR = "#f43f5e"; // rose -- matches --accent-rose

// Separate from levels on purpose: levels track cumulative points (long-term
// effort), achievements are one-time milestones — mostly continuity
// (longest streak ever reached, so they stay unlocked even after a streak
// resets) plus a couple of volume/points milestones for variety.
export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "first-close",
    titleKey: "achievement.first-close.title",
    descriptionKey: "achievement.first-close.description",
    icon: Sprout,
    color: STREAK_COLOR,
    isUnlocked: (s) => s.totalDaysClosed >= 1,
  },
  {
    id: "streak-3",
    titleKey: "achievement.streak-3.title",
    descriptionKey: "achievement.streak-3.description",
    icon: Sparkles,
    color: STREAK_COLOR,
    isUnlocked: (s) => s.longestStreak >= 3,
  },
  {
    id: "challenge-5-day",
    titleKey: "achievement.challenge-5-day.title",
    descriptionKey: "achievement.challenge-5-day.description",
    icon: Flag,
    color: STREAK_COLOR,
    isUnlocked: (s) => s.longestStreak >= 5,
  },
  {
    id: "streak-7",
    titleKey: "achievement.streak-7.title",
    descriptionKey: "achievement.streak-7.description",
    icon: Flame,
    color: STREAK_COLOR,
    isUnlocked: (s) => s.longestStreak >= 7,
  },
  {
    id: "streak-14",
    titleKey: "achievement.streak-14.title",
    descriptionKey: "achievement.streak-14.description",
    icon: Dumbbell,
    color: STREAK_COLOR,
    isUnlocked: (s) => s.longestStreak >= 14,
  },
  {
    id: "streak-30",
    titleKey: "achievement.streak-30.title",
    descriptionKey: "achievement.streak-30.description",
    icon: Trophy,
    color: STREAK_COLOR,
    isUnlocked: (s) => s.longestStreak >= 30,
  },
  {
    id: "streak-100",
    titleKey: "achievement.streak-100.title",
    descriptionKey: "achievement.streak-100.description",
    icon: Crown,
    color: STREAK_COLOR,
    isUnlocked: (s) => s.longestStreak >= 100,
  },
  {
    id: "streak-200",
    titleKey: "achievement.streak-200.title",
    descriptionKey: "achievement.streak-200.description",
    icon: Orbit,
    color: STREAK_COLOR,
    isUnlocked: (s) => s.longestStreak >= 200,
  },
  {
    id: "streak-365",
    titleKey: "achievement.streak-365.title",
    descriptionKey: "achievement.streak-365.description",
    icon: PartyPopper,
    color: STREAK_COLOR,
    isUnlocked: (s) => s.longestStreak >= 365,
  },
  {
    id: "goals-10",
    titleKey: "achievement.goals-10.title",
    descriptionKey: "achievement.goals-10.description",
    icon: CheckCircle2,
    color: GOALS_COLOR,
    isUnlocked: (s) => s.totalGoalsCompleted >= 10,
  },
  {
    id: "goals-50",
    titleKey: "achievement.goals-50.title",
    descriptionKey: "achievement.goals-50.description",
    icon: Target,
    color: GOALS_COLOR,
    isUnlocked: (s) => s.totalGoalsCompleted >= 50,
  },
  {
    id: "goals-100",
    titleKey: "achievement.goals-100.title",
    descriptionKey: "achievement.goals-100.description",
    icon: Rocket,
    color: GOALS_COLOR,
    isUnlocked: (s) => s.totalGoalsCompleted >= 100,
  },
  {
    id: "goals-250",
    titleKey: "achievement.goals-250.title",
    descriptionKey: "achievement.goals-250.description",
    icon: Shield,
    color: GOALS_COLOR,
    isUnlocked: (s) => s.totalGoalsCompleted >= 250,
  },
  {
    id: "goals-500",
    titleKey: "achievement.goals-500.title",
    descriptionKey: "achievement.goals-500.description",
    icon: Mountain,
    color: GOALS_COLOR,
    isUnlocked: (s) => s.totalGoalsCompleted >= 500,
  },
  {
    id: "points-100",
    titleKey: "achievement.points-100.title",
    descriptionKey: "achievement.points-100.description",
    icon: Percent,
    color: POINTS_COLOR,
    isUnlocked: (s) => s.totalPoints >= 100,
  },
  {
    id: "points-500",
    titleKey: "achievement.points-500.title",
    descriptionKey: "achievement.points-500.description",
    icon: Star,
    color: POINTS_COLOR,
    isUnlocked: (s) => s.totalPoints >= 500,
  },
  {
    id: "points-1000",
    titleKey: "achievement.points-1000.title",
    descriptionKey: "achievement.points-1000.description",
    icon: Medal,
    color: POINTS_COLOR,
    isUnlocked: (s) => s.totalPoints >= 1000,
  },
  {
    id: "points-2000",
    titleKey: "achievement.points-2000.title",
    descriptionKey: "achievement.points-2000.description",
    icon: Award,
    color: POINTS_COLOR,
    isUnlocked: (s) => s.totalPoints >= 2000,
  },
  {
    id: "points-5000",
    titleKey: "achievement.points-5000.title",
    descriptionKey: "achievement.points-5000.description",
    icon: Gem,
    color: POINTS_COLOR,
    isUnlocked: (s) => s.totalPoints >= 5000,
  },
  {
    id: "points-10000",
    titleKey: "achievement.points-10000.title",
    descriptionKey: "achievement.points-10000.description",
    icon: Diamond,
    color: POINTS_COLOR,
    isUnlocked: (s) => s.totalPoints >= 10000,
  },
  {
    id: "reschedule-closed",
    titleKey: "achievement.reschedule-closed.title",
    descriptionKey: "achievement.reschedule-closed.description",
    icon: Repeat,
    color: RECOVERY_COLOR,
    isUnlocked: (s) => s.reschedulesCompleted >= 1,
  },
  {
    id: "tracked-goal-closed",
    titleKey: "achievement.tracked-goal-closed.title",
    descriptionKey: "achievement.tracked-goal-closed.description",
    icon: Search,
    color: GOALS_COLOR,
    isUnlocked: (s) => s.trackedGoalsCompleted >= 1,
  },
  {
    id: "challenge-5-goals",
    titleKey: "achievement.challenge-5-goals.title",
    descriptionKey: "achievement.challenge-5-goals.description",
    icon: ListChecks,
    color: GOALS_COLOR,
    isUnlocked: (s) => s.maxGoalsCompletedInDay >= 5,
  },
  {
    id: "referral-1",
    titleKey: "achievement.referral-1.title",
    descriptionKey: "achievement.referral-1.description",
    icon: Handshake,
    color: SOCIAL_COLOR,
    isUnlocked: (s) => s.totalReferrals >= 1,
  },
  {
    id: "referral-5",
    titleKey: "achievement.referral-5.title",
    descriptionKey: "achievement.referral-5.description",
    icon: Globe,
    color: SOCIAL_COLOR,
    isUnlocked: (s) => s.totalReferrals >= 5,
  },
  {
    id: "social-share",
    titleKey: "achievement.social-share.title",
    descriptionKey: "achievement.social-share.description",
    icon: Megaphone,
    color: SOCIAL_COLOR,
    isUnlocked: (s) => s.hasShared,
  },
];
