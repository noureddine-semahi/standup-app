import type { TranslationKey } from "@/lib/i18n/en";

export type LevelInfo = {
  level: number;
  // A translation key, not the literal name — this is a plain function
  // outside React with no way to know the current language on its own, so
  // every consumer calls t(levelInfo.nameKey) itself.
  nameKey: TranslationKey;
  minPoints: number;
  nextLevelPoints: number | null; // null = max level reached
  pointsIntoLevel: number;
  pointsToNext: number | null;
  progressPct: number; // 0-100 toward next level; 100 if max level
};

// Discipline/execution themed, matches the app's "daily execution system"
// branding. Increasing span per level so early levels come quickly (keeps
// new users motivated) and later ones take sustained effort. Runs all the
// way to 10,000 points as a long-horizon ceiling for extreme/power users —
// at a typical 5-15 pts/day that's roughly 2-5+ years of daily use.
const LEVELS: { nameKey: TranslationKey; minPoints: number }[] = [
  { nameKey: "level.starter", minPoints: 0 },
  { nameKey: "level.committed", minPoints: 50 },
  { nameKey: "level.consistent", minPoints: 150 },
  { nameKey: "level.disciplined", minPoints: 300 },
  { nameKey: "level.relentless", minPoints: 500 },
  { nameKey: "level.unstoppable", minPoints: 800 },
  { nameKey: "level.elite", minPoints: 1200 },
  { nameKey: "level.legendary", minPoints: 1800 },
  { nameKey: "level.mythic", minPoints: 2600 },
  { nameKey: "level.immortal", minPoints: 3600 },
  { nameKey: "level.transcendent", minPoints: 5000 },
  { nameKey: "level.ascended", minPoints: 6500 },
  { nameKey: "level.eternal", minPoints: 8200 },
  { nameKey: "level.infinite", minPoints: 10000 },
];

export function getLevelInfo(points: number): LevelInfo {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (points >= LEVELS[i].minPoints) idx = i;
  }

  const current = LEVELS[idx];
  const next = LEVELS[idx + 1] ?? null;
  const pointsIntoLevel = points - current.minPoints;
  const levelSpan = next ? next.minPoints - current.minPoints : null;
  const progressPct =
    next && levelSpan ? Math.min(100, Math.round((pointsIntoLevel / levelSpan) * 100)) : 100;

  return {
    level: idx + 1,
    nameKey: current.nameKey,
    minPoints: current.minPoints,
    nextLevelPoints: next?.minPoints ?? null,
    pointsIntoLevel,
    pointsToNext: next ? next.minPoints - points : null,
    progressPct,
  };
}
