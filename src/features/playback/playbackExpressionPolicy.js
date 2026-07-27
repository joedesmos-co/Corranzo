/**
 * Documented playback-expression policy (Playback Semantics Sprint 1).
 *
 * Written MusicXML durations / pitches are never rewritten here.
 * These factors apply only to performed sounding duration and velocity.
 */

import { DYNAMICS_TO_VELOCITY } from '../musicxml/dynamicsMap.js'

/** Staccato sounding duration as a fraction of written duration. */
export const STACCATO_PLAYBACK_RATIO = 0.5

/** Tenuto: slight lengthening within safe bounds (still ≤ 1.15× written). */
export const TENUTO_PLAYBACK_RATIO = 1.05
export const TENUTO_PLAYBACK_RATIO_MAX = 1.15

/** Marcato: stronger attack + controlled shortening of sounding duration. */
export const MARCATO_VELOCITY_BOOST = 0.2
export const MARCATO_DURATION_RATIO = 0.65

/** Accent: attack emphasis on top of the active dynamic velocity. */
export const ACCENT_VELOCITY_BOOST = 0.12

/**
 * Fermata: multiply sounding duration by this factor.
 * Policy: hold ~1.75× written value (common pedagogical default).
 * Cursor/timeline written measure length is unchanged; only sounding release extends.
 */
export const FERMATA_DURATION_RATIO = 1.75

/**
 * When a crescendo/diminuendo wedge ends without a new discrete dynamic,
 * move the endpoint by this delta from the start velocity (clamped).
 * Documented conservative fallback — does not invent a named dynamic mark.
 */
export const WEDGE_ENDPOINT_FALLBACK_DELTA = 0.18

export const MIN_PLAYBACK_DURATION_SECONDS = 0.03

/** Re-export the discrete dynamics → velocity table (pp…ff). */
export const PLAYBACK_DYNAMICS_VELOCITY = DYNAMICS_TO_VELOCITY
