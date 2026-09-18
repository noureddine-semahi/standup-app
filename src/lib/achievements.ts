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
  icon: string;
  isUnlocked: (stats: AchievementStats) => boolean;
};

// Separate from levels on purpose: levels track cumulative points (long-term
// effort), achievements are one-time milestones — mostly continuity
// (longest streak ever reached, so they stay unlocked even after a streak
// resets) plus a couple of volume/points milestones for variety.
export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "first-close",
    titleKey: "achievement.first-close.title",
    descriptionKey: "achievement.first-close.description",
    icon: "🌱",
    isUnlocked: (s) => s.totalDaysClosed >= 1,
  },
  {
    id: "streak-3",
    titleKey: "achievement.streak-3.title",
    descriptionKey: "achievement.streak-3.description",
    icon: "✨",
    isUnlocked: (s) => s.longestStreak >= 3,
  },
  {
    id: "challenge-5-day",
    titleKey: "achievement.challenge-5-day.title",
    descriptionKey: "achievement.challenge-5-day.description",
    icon: "🏁",
    isUnlocked: (s) => s.longestStreak >= 5,
  },
  {
    id: "streak-7",
    titleKey: "achievement.streak-7.title",
    descriptionKey: "achievement.streak-7.description",
    icon: "🔥",
    isUnlocked: (s) => s.longestStreak >= 7,
  },
  {
    id: "streak-14",
    titleKey: "achievement.streak-14.title",
    descriptionKey: "achievement.streak-14.description",
    icon: "💪",
    isUnlocked: (s) => s.longestStreak >= 14,
  },
  {
    id: "streak-30",
    titleKey: "achievement.streak-30.title",
    descriptionKey: "achievement.streak-30.description",
    icon: "🏆",
    isUnlocked: (s) => s.longestStreak >= 30,
  },
  {
    id: "streak-100",
    titleKey: "achievement.streak-100.title",
    descriptionKey: "achievement.streak-100.description",
    icon: "👑",
    isUnlocked: (s) => s.longestStreak >= 100,
  },
  {
    id: "streak-200",
    titleKey: "achievement.streak-200.title",
    descriptionKey: "achievement.streak-200.description",
    icon: "🌌",
    isUnlocked: (s) => s.longestStreak >= 200,
  },
  {
    id: "streak-365",
    titleKey: "achievement.streak-365.title",
    descriptionKey: "achievement.streak-365.description",
    icon: "🎆",
    isUnlocked: (s) => s.longestStreak >= 365,
  },
  {
    id: "goals-10",
    titleKey: "achievement.goals-10.title",
    descriptionKey: "achievement.goals-10.description",
    icon: "✅",
    isUnlocked: (s) => s.totalGoalsCompleted >= 10,
  },
  {
    id: "goals-50",
    titleKey: "achievement.goals-50.title",
    descriptionKey: "achievement.goals-50.description",
    icon: "🎯",
    isUnlocked: (s) => s.totalGoalsCompleted >= 50,
  },
  {
    id: "goals-100",
    titleKey: "achievement.goals-100.title",
    descriptionKey: "achievement.goals-100.description",
    icon: "🚀",
    isUnlocked: (s) => s.totalGoalsCompleted >= 100,
  },
  {
    id: "goals-250",
    titleKey: "achievement.goals-250.title",
    descriptionKey: "achievement.goals-250.description",
    icon: "🛡️",
    isUnlocked: (s) => s.totalGoalsCompleted >= 250,
  },
  {
    id: "goals-500",
    titleKey: "achievement.goals-500.title",
    descriptionKey: "achievement.goals-500.description",
    icon: "🏔️",
    isUnlocked: (s) => s.totalGoalsCompleted >= 500,
  },
  {
    id: "points-100",
    titleKey: "achievement.points-100.title",
    descriptionKey: "achievement.points-100.description",
    icon: "💯",
    isUnlocked: (s) => s.totalPoints >= 100,
  },
  {
    id: "points-500",
    titleKey: "achievement.points-500.title",
    descriptionKey: "achievement.points-500.description",
    icon: "⭐",
    isUnlocked: (s) => s.totalPoints >= 500,
  },
  {
    id: "points-1000",
    titleKey: "achievement.points-1000.title",
    descriptionKey: "achievement.points-1000.description",
    icon: "🥈",
    isUnlocked: (s) => s.totalPoints >= 1000,
  },
  {
    id: "points-2000",
    titleKey: "achievement.points-2000.title",
    descriptionKey: "achievement.points-2000.description",
    icon: "🥇",
    isUnlocked: (s) => s.totalPoints >= 2000,
  },
  {
    id: "points-5000",
    titleKey: "achievement.points-5000.title",
    descriptionKey: "achievement.points-5000.description",
    icon: "💎",
    isUnlocked: (s) => s.totalPoints >= 5000,
  },
  {
    id: "points-10000",
    titleKey: "achievement.points-10000.title",
    descriptionKey: "achievement.points-10000.description",
    icon: "💠",
    isUnlocked: (s) => s.totalPoints >= 10000,
  },
  {
    id: "reschedule-closed",
    titleKey: "achievement.reschedule-closed.title",
    descriptionKey: "achievement.reschedule-closed.description",
    icon: "🔁",
    isUnlocked: (s) => s.reschedulesCompleted >= 1,
  },
  {
    id: "tracked-goal-closed",
    titleKey: "achievement.tracked-goal-closed.title",
    descriptionKey: "achievement.tracked-goal-closed.description",
    icon: "🔍",
    isUnlocked: (s) => s.trackedGoalsCompleted >= 1,
  },
  {
    id: "challenge-5-goals",
    titleKey: "achievement.challenge-5-goals.title",
    descriptionKey: "achievement.challenge-5-goals.description",
    icon: "🖐️",
    isUnlocked: (s) => s.maxGoalsCompletedInDay >= 5,
  },
  {
    id: "referral-1",
    titleKey: "achievement.referral-1.title",
    descriptionKey: "achievement.referral-1.description",
    icon: "🤝",
    isUnlocked: (s) => s.totalReferrals >= 1,
  },
  {
    id: "referral-5",
    titleKey: "achievement.referral-5.title",
    descriptionKey: "achievement.referral-5.description",
    icon: "🌐",
    isUnlocked: (s) => s.totalReferrals >= 5,
  },
  {
    id: "social-share",
    titleKey: "achievement.social-share.title",
    descriptionKey: "achievement.social-share.description",
    icon: "📣",
    isUnlocked: (s) => s.hasShared,
  },
];
