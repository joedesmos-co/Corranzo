import { WFY_STATUS } from './waitForYouEngine.js'
import { WFY_INPUT_OUTCOME } from './waitForYouInputFeedback.js'
import { WFY_GUIDANCE } from './waitForYouGuidance.js'

export const WFY_DISPLAY_STATUS = {
  INACTIVE: 'inactive',
  NO_CHECKPOINTS: 'no-checkpoints',
  COMPLETE: 'complete',
  WAITING: 'waiting',
  CORRECT: 'correct',
  MISSED: 'missed',
  CONTINUING: 'continuing',
}

export const WFY_DISPLAY_LABELS = {
  [WFY_DISPLAY_STATUS.INACTIVE]: '',
  [WFY_DISPLAY_STATUS.NO_CHECKPOINTS]: 'No checkpoints',
  [WFY_DISPLAY_STATUS.COMPLETE]: 'Section complete',
  [WFY_DISPLAY_STATUS.WAITING]: 'Waiting',
  [WFY_DISPLAY_STATUS.CORRECT]: 'Correct note',
  [WFY_DISPLAY_STATUS.MISSED]: 'Missed / late',
  [WFY_DISPLAY_STATUS.CONTINUING]: 'Continuing',
}

/**
 * Single headline status for Wait For You UI (status strip, section header, HUD).
 */
export function resolveWfyDisplayStatus({
  active = false,
  engineStatus,
  displayPhase = null,
  inputFeedback = null,
  guidance = null,
}) {
  if (!active) {
    return WFY_DISPLAY_STATUS.INACTIVE
  }
  if (engineStatus === WFY_STATUS.NO_CHECKPOINTS) {
    return WFY_DISPLAY_STATUS.NO_CHECKPOINTS
  }
  if (engineStatus === WFY_STATUS.COMPLETE) {
    return WFY_DISPLAY_STATUS.COMPLETE
  }
  if (displayPhase === 'continuing') {
    return WFY_DISPLAY_STATUS.CONTINUING
  }
  if (displayPhase === 'correct') {
    return WFY_DISPLAY_STATUS.CORRECT
  }

  const outcome = inputFeedback?.outcome
  const guidanceState = guidance?.state

  if (
    outcome === WFY_INPUT_OUTCOME.WRONG ||
    guidanceState === WFY_GUIDANCE.WRONG
  ) {
    return WFY_DISPLAY_STATUS.MISSED
  }

  if (
    outcome === WFY_INPUT_OUTCOME.CORRECT ||
    guidanceState === WFY_GUIDANCE.CORRECT
  ) {
    return WFY_DISPLAY_STATUS.CORRECT
  }

  return WFY_DISPLAY_STATUS.WAITING
}

export function labelForWfyDisplayStatus(status) {
  return WFY_DISPLAY_LABELS[status] ?? ''
}
