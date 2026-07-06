/** Guidance state tokens — isolated so display-status UI does not import the full guidance engine. */
export const WFY_GUIDANCE = {
  IDLE: 'idle',
  WAITING: 'waiting',
  CORRECT: 'correct',
  WRONG: 'wrong',
  PARTIAL: 'partial',
  HINT: 'hint',
  COMPLETE: 'complete',
}

/** Number of wrong attempts at which the cursor target is revealed automatically. */
export const HINT_AFTER_WRONG_ATTEMPTS = 2
