/** Musician-friendly copy for score cursor setup (main UI). Kept short. */
export const SCORE_FOLLOW_SETUP_RUNNING = 'Setting up score cursor…'

/** High-confidence automatic setup (conservative staff detection). */
export const SCORE_FOLLOW_SETUP_COMPLETE = 'Auto setup complete'
/** Automatic setup applied, but coarser (tolerant / geometric / low confidence). */
export const SCORE_FOLLOW_SETUP_APPROXIMATE = 'Approximate cursor'
/** Automatic setup could not produce a mapping — rare last-resort fallback. */
export const SCORE_FOLLOW_NEEDS_QUICK_SETUP = 'Needs quick setup'

export const SCORE_FOLLOW_SETUP_READY_USER = SCORE_FOLLOW_SETUP_APPROXIMATE
export const SCORE_FOLLOW_SETUP_READY_DEMO = 'Sample score cursor ready'
export const SCORE_FOLLOW_NEEDS_SETUP = SCORE_FOLLOW_NEEDS_QUICK_SETUP
export const SCORE_FOLLOW_APPROXIMATE_HINT = SCORE_FOLLOW_SETUP_APPROXIMATE
/** @deprecated Use SCORE_FOLLOW_SETUP_READY_USER */
export const SCORE_FOLLOW_SETUP_READY = SCORE_FOLLOW_SETUP_READY_USER
export const SCORE_FOLLOW_SETUP_NEEDS_CORRECTION = SCORE_FOLLOW_NEEDS_QUICK_SETUP

export const SCORE_FOLLOW_SETUP_FAILED_DEMO = 'Sample setup needs a quick retry'

/** When timing-file layout cannot be reconciled with the uploaded PDF. */
export const SCORE_FOLLOW_SETUP_FILE_MISMATCH =
  'This timing file does not appear to match the PDF closely enough for automatic setup. Try a matching timing file, or use Quick Setup.'

/** Concise last-resort copy shown only when no systems could be detected. */
export const SCORE_FOLLOW_NO_SYSTEMS = 'Auto setup could not find systems. Mark system starts.'

/** Experimental OMR-generated playback — score cursor setup in progress. */
export const SCORE_FOLLOW_OMR_SETUP_RUNNING = 'Setting up score cursor…'

/** Experimental OMR playback is ready before score-follow auto-setup runs. */
export const SCORE_FOLLOW_OMR_PLAYBACK_READY = 'Experimental playback ready'

/** Experimental OMR playback remains usable when automatic score-follow fails. */
export const SCORE_FOLLOW_OMR_SETUP_FAILED =
  'Experimental playback ready — score cursor unavailable for this generated score.'
