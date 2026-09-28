/** Canonical product vocabulary. Legacy "normal" meant timed Play Along. */
export const PRACTICE_MODE = {
  PREVIEW: 'preview',
  PLAY_ALONG: 'play-along',
  WAIT_FOR_YOU: 'wait-for-you',
}
export const PRACTICE_MODE_LABELS = {
  [PRACTICE_MODE.PREVIEW]: 'Preview',
  [PRACTICE_MODE.PLAY_ALONG]: 'Play Along',
  [PRACTICE_MODE.WAIT_FOR_YOU]: 'Wait For You',
}
export function normalizePracticeMode(value) {
  if (value === 'normal') return PRACTICE_MODE.PLAY_ALONG
  return Object.values(PRACTICE_MODE).includes(value) ? value : PRACTICE_MODE.PREVIEW
}
export function practiceInputEnabled(mode) {
  return mode === PRACTICE_MODE.PLAY_ALONG || mode === PRACTICE_MODE.WAIT_FOR_YOU
}
