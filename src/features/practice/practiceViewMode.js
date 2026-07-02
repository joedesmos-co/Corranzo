/**
 * Practice score display mode: classic sheet-music Score view vs the
 * beginner-friendly Visual note-lane view. Persisted separately from the
 * main practice prefs so it never disturbs the existing prefs schema.
 */

export const PRACTICE_VIEW_MODE = {
  SCORE: 'score',
  VISUAL: 'visual',
}

export const PRACTICE_VIEW_MODE_LABELS = {
  [PRACTICE_VIEW_MODE.SCORE]: 'Score',
  [PRACTICE_VIEW_MODE.VISUAL]: 'Visual',
}

const VIEW_MODE_KEY = 'scoreflow-practice-view-mode-v1'

export function normalizePracticeViewMode(value) {
  return value === PRACTICE_VIEW_MODE.VISUAL
    ? PRACTICE_VIEW_MODE.VISUAL
    : PRACTICE_VIEW_MODE.SCORE
}

export function loadPracticeViewMode() {
  try {
    return normalizePracticeViewMode(localStorage.getItem(VIEW_MODE_KEY))
  } catch {
    return PRACTICE_VIEW_MODE.SCORE
  }
}

export function savePracticeViewMode(mode) {
  try {
    localStorage.setItem(VIEW_MODE_KEY, normalizePracticeViewMode(mode))
    return true
  } catch {
    return false
  }
}
