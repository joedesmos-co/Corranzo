/** Musician-friendly copy for score-follow setup (main UI). Kept short. */
export const SCORE_FOLLOW_SETUP_RUNNING = 'Setting up score follow…'

/** High-confidence automatic setup (conservative staff detection). */
export const SCORE_FOLLOW_SETUP_COMPLETE = 'Auto setup complete'
/** Automatic setup applied, but coarser (tolerant / geometric / low confidence). */
export const SCORE_FOLLOW_SETUP_APPROXIMATE = 'Approximate cursor'
/** Automatic setup could not produce a mapping — rare last-resort fallback. */
export const SCORE_FOLLOW_NEEDS_QUICK_SETUP = 'Needs quick setup'

export const SCORE_FOLLOW_SETUP_READY_USER = SCORE_FOLLOW_SETUP_APPROXIMATE
export const SCORE_FOLLOW_SETUP_READY_DEMO = 'Sample score follow ready'
export const SCORE_FOLLOW_NEEDS_SETUP = SCORE_FOLLOW_NEEDS_QUICK_SETUP
export const SCORE_FOLLOW_APPROXIMATE_HINT = SCORE_FOLLOW_SETUP_APPROXIMATE
/** @deprecated Use SCORE_FOLLOW_SETUP_READY_USER */
export const SCORE_FOLLOW_SETUP_READY = SCORE_FOLLOW_SETUP_READY_USER
export const SCORE_FOLLOW_SETUP_NEEDS_CORRECTION = SCORE_FOLLOW_NEEDS_QUICK_SETUP

export const SCORE_FOLLOW_SETUP_FAILED_DEMO = 'Sample setup needs a quick retry'

/** Concise last-resort copy shown only when no systems could be detected. */
export const SCORE_FOLLOW_NO_SYSTEMS = 'Auto setup could not find systems. Mark system starts.'
