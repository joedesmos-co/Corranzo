const LEVEL_THRESHOLDS = [0, 30, 80, 150, 250, 400, 600, 850, 1200, 1650, 2200]

const LEVEL_LABELS = [
  'Getting started',
  'Warm-up',
  'Regular',
  'Steady',
  'Dedicated',
  'Focused',
  'Committed',
  'Seasoned',
  'Fluent',
  'Mastery',
  'Long practice',
]

export function xpForSession(session) {
  let xp = 0
  const activeMinutes = Math.floor((session.practiceSecondsActive ?? 0) / 60)
  xp += Math.min(24, activeMinutes * 2)
  if (session.completed) {
    xp += 10
  }
  xp += Math.min(20, (session.wfyNotesMatched ?? 0) * 1)
  if ((session.loopsPracticed ?? 0) > 0) {
    xp += 3
  }
  return xp
}

export function getLevelFromXp(totalXp) {
  const xp = Math.max(0, Number(totalXp) || 0)
  let level = 0
  for (let index = 1; index < LEVEL_THRESHOLDS.length; index += 1) {
    if (xp >= LEVEL_THRESHOLDS[index]) {
      level = index
    }
  }
  const currentThreshold = LEVEL_THRESHOLDS[level] ?? 0
  const nextThreshold = LEVEL_THRESHOLDS[level + 1] ?? currentThreshold + 500
  const span = Math.max(1, nextThreshold - currentThreshold)
  const progress = level >= LEVEL_LABELS.length - 1 ? 1 : (xp - currentThreshold) / span

  return {
    level: level + 1,
    label: LEVEL_LABELS[Math.min(level, LEVEL_LABELS.length - 1)],
    progress: Math.min(1, Math.max(0, progress)),
    xpToNext: Math.max(0, nextThreshold - xp),
    isMaxLevel: level >= LEVEL_LABELS.length - 1,
  }
}
