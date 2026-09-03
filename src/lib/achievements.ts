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

export type AchievementDef = {
  id: string;
  title: string;
  description: string;
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
    title: "First Steps",
    description: "Close out your first day",
    icon: "🌱",
    isUnlocked: (s) => s.totalDaysClosed >= 1,
  },
  {
    id: "streak-3",
    title: "3-Day Spark",
    description: "Reach a 3-day streak",
    icon: "✨",
    isUnlocked: (s) => s.longestStreak >= 3,
  },
  {
    id: "challenge-5-day",
    title: "5-Day Challenge",
    description: "Take on and complete a 5-day streak challenge",
    icon: "🏁",
    isUnlocked: (s) => s.longestStreak >= 5,
  },
  {
    id: "streak-7",
    title: "Week One",
    description: "Reach a 7-day streak",
    icon: "🔥",
    isUnlocked: (s) => s.longestStreak >= 7,
  },
  {
    id: "streak-14",
    title: "Two Weeks Strong",
    description: "Reach a 14-day streak",
    icon: "💪",
    isUnlocked: (s) => s.longestStreak >= 14,
  },
  {
    id: "streak-30",
    title: "30-Day Habit",
    description: "Reach a 30-day streak",
    icon: "🏆",
    isUnlocked: (s) => s.longestStreak >= 30,
  },
  {
    id: "streak-100",
    title: "100 Days Relentless",
    description: "Reach a 100-day streak",
    icon: "👑",
    isUnlocked: (s) => s.longestStreak >= 100,
  },
  {
    id: "streak-200",
    title: "200-Day Legend",
    description: "Reach a 200-day streak",
    icon: "🌌",
    isUnlocked: (s) => s.longestStreak >= 200,
  },
  {
    id: "streak-365",
    title: "Full Year",
    description: "Reach a 365-day streak",
    icon: "🎆",
    isUnlocked: (s) => s.longestStreak >= 365,
  },
  {
    id: "goals-10",
    title: "10 Goals Down",
    description: "Complete 10 goals",
    icon: "✅",
    isUnlocked: (s) => s.totalGoalsCompleted >= 10,
  },
  {
    id: "goals-50",
    title: "50 Goals Down",
    description: "Complete 50 goals",
    icon: "🎯",
    isUnlocked: (s) => s.totalGoalsCompleted >= 50,
  },
  {
    id: "goals-100",
    title: "100 Goals Down",
    description: "Complete 100 goals",
    icon: "🚀",
    isUnlocked: (s) => s.totalGoalsCompleted >= 100,
  },
  {
    id: "goals-250",
    title: "250 Goals Down",
    description: "Complete 250 goals",
    icon: "🛡️",
    isUnlocked: (s) => s.totalGoalsCompleted >= 250,
  },
  {
    id: "goals-500",
    title: "500 Goals Down",
    description: "Complete 500 goals",
    icon: "🏔️",
    isUnlocked: (s) => s.totalGoalsCompleted >= 500,
  },
  {
    id: "points-100",
    title: "Century Club",
    description: "Earn 100 total points",
    icon: "💯",
    isUnlocked: (s) => s.totalPoints >= 100,
  },
  {
    id: "points-500",
    title: "500 Point Club",
    description: "Earn 500 total points",
    icon: "⭐",
    isUnlocked: (s) => s.totalPoints >= 500,
  },
  {
    id: "points-1000",
    title: "1,000 Point Club",
    description: "Earn 1,000 total points",
    icon: "🥈",
    isUnlocked: (s) => s.totalPoints >= 1000,
  },
  {
    id: "points-2000",
    title: "2,000 Point Club",
    description: "Earn 2,000 total points",
    icon: "🥇",
    isUnlocked: (s) => s.totalPoints >= 2000,
  },
  {
    id: "points-5000",
    title: "5,000 Point Club",
    description: "Earn 5,000 total points",
    icon: "💎",
    isUnlocked: (s) => s.totalPoints >= 5000,
  },
  {
    id: "points-10000",
    title: "10,000 Point Club",
    description: "Earn 10,000 total points",
    icon: "💠",
    isUnlocked: (s) => s.totalPoints >= 10000,
  },
  {
    id: "reschedule-closed",
    title: "Second Chance",
    description: "Complete a goal after rescheduling it",
    icon: "🔁",
    isUnlocked: (s) => s.reschedulesCompleted >= 1,
  },
  {
    id: "tracked-goal-closed",
    title: "Follow-Through",
    description: "Complete a goal you tracked with notes",
    icon: "🔍",
    isUnlocked: (s) => s.trackedGoalsCompleted >= 1,
  },
  {
    id: "challenge-5-goals",
    title: "High Five",
    description: "Complete 5 goals in a single day",
    icon: "🖐️",
    isUnlocked: (s) => s.maxGoalsCompletedInDay >= 5,
  },
  {
    id: "referral-1",
    title: "Referral Rookie",
    description: "Refer a friend who completes their first day",
    icon: "🤝",
    isUnlocked: (s) => s.totalReferrals >= 1,
  },
  {
    id: "referral-5",
    title: "Community Builder",
    description: "Refer 5 friends who complete their first day",
    icon: "🌐",
    isUnlocked: (s) => s.totalReferrals >= 5,
  },
  {
    id: "social-share",
    title: "Spread the Word",
    description: "Share your progress",
    icon: "📣",
    isUnlocked: (s) => s.hasShared,
  },
];
