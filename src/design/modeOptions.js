/**
 * Practice mode vocabulary — single source of truth for the three-state
 * mode control. UI labels use musician language; code values stay stable.
 */

import { PRACTICE_MODE } from '../features/practice/practiceMode.js'
export const PRACTICE_MODES = PRACTICE_MODE

export const PRACTICE_MODE_OPTIONS = [
  {
    value: PRACTICE_MODES.PREVIEW,
    label: 'Preview',
    hint: 'Listen and follow the score',
    icon: 'music',
  },
  {
    value: PRACTICE_MODES.PLAY_ALONG,
    label: 'Play Along',
    hint: 'Play together — the cursor keeps time',
    icon: 'play',
  },
  {
    value: PRACTICE_MODES.WAIT_FOR_YOU,
    label: 'Wait For You',
    hint: 'Pauses on each note until you play it',
    icon: 'follow',
  },
]

export function isPracticeMode(value) {
  return Object.values(PRACTICE_MODES).includes(value)
}
