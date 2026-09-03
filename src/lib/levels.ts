export type LevelInfo = {
  level: number;
  name: string;
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
const LEVELS: { name: string; minPoints: number }[] = [
  { name: "Starter", minPoints: 0 },
  { name: "Committed", minPoints: 50 },
  { name: "Consistent", minPoints: 150 },
  { name: "Disciplined", minPoints: 300 },
  { name: "Relentless", minPoints: 500 },
  { name: "Unstoppable", minPoints: 800 },
  { name: "Elite", minPoints: 1200 },
  { name: "Legendary", minPoints: 1800 },
  { name: "Mythic", minPoints: 2600 },
  { name: "Immortal", minPoints: 3600 },
  { name: "Transcendent", minPoints: 5000 },
  { name: "Ascended", minPoints: 6500 },
  { name: "Eternal", minPoints: 8200 },
  { name: "Infinite", minPoints: 10000 },
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
    name: current.name,
    minPoints: current.minPoints,
    nextLevelPoints: next?.minPoints ?? null,
    pointsIntoLevel,
    pointsToNext: next ? next.minPoints - points : null,
    progressPct,
  };
}
