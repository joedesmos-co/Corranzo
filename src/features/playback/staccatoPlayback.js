/**
 * Derive performed sounding duration and velocity from recognized markings.
 * Does not mutate written MusicXML durations or MIDI pitch.
 */

import { DEFAULT_MUSICXML_VELOCITY } from '../musicxml/dynamicsMap.js'
import { sanitizePlaybackDurationSeconds, sanitizePlaybackVelocity } from './sanitizePlaybackNote.js'
import {
  STACCATO_PLAYBACK_RATIO,
  TENUTO_PLAYBACK_RATIO,
  TENUTO_PLAYBACK_RATIO_MAX,
  MARCATO_VELOCITY_BOOST,
  MARCATO_DURATION_RATIO,
  ACCENT_VELOCITY_BOOST,
  FERMATA_DURATION_RATIO,
  MIN_PLAYBACK_DURATION_SECONDS,
} from './playbackExpressionPolicy.js'

export {
  STACCATO_PLAYBACK_RATIO,
  ACCENT_VELOCITY_BOOST,
  MIN_PLAYBACK_DURATION_SECONDS,
  TENUTO_PLAYBACK_RATIO,
  MARCATO_VELOCITY_BOOST,
  MARCATO_DURATION_RATIO,
  FERMATA_DURATION_RATIO,
} from './playbackExpressionPolicy.js'

export function staccatoPlaybackDurationSeconds(writtenDurationSeconds) {
  const written = sanitizePlaybackDurationSeconds(writtenDurationSeconds)
  return Math.max(MIN_PLAYBACK_DURATION_SECONDS, written * STACCATO_PLAYBACK_RATIO)
}

function articulationDurationRatio(note) {
  // Precedence: fermata > staccato > marcato > tenuto > plain
  if (note?.fermata) {
    return FERMATA_DURATION_RATIO
  }
  if (note?.staccato) {
    return STACCATO_PLAYBACK_RATIO
  }
  if (note?.marcato) {
    return MARCATO_DURATION_RATIO
  }
  if (note?.tenuto) {
    return Math.min(TENUTO_PLAYBACK_RATIO_MAX, TENUTO_PLAYBACK_RATIO)
  }
  return 1
}

/** Sounding duration for playback; score-follow keeps written duration. */
export function playbackDurationSecondsForNote(note) {
  const written = sanitizePlaybackDurationSeconds(note?.durationSeconds)
  const ratio = articulationDurationRatio(note)
  return Math.max(MIN_PLAYBACK_DURATION_SECONDS, written * ratio)
}

/** Playback velocity with accent/marcato emphasis. */
export function playbackVelocityForNote(note) {
  const base = sanitizePlaybackVelocity(note?.velocity ?? DEFAULT_MUSICXML_VELOCITY)
  let velocity = base
  if (note?.marcato) {
    velocity = Math.min(1, velocity + MARCATO_VELOCITY_BOOST)
  } else if (note?.accent) {
    velocity = Math.min(1, velocity + ACCENT_VELOCITY_BOOST)
  }
  return velocity
}

/** Human-readable articulation source for benchmarks. */
export function articulationSourceForNote(note) {
  const parts = []
  if (note?.fermata) {
    parts.push('fermata')
  }
  if (note?.staccato) {
    parts.push('staccato')
  }
  if (note?.marcato) {
    parts.push('marcato')
  } else if (note?.accent) {
    parts.push('accent')
  }
  if (note?.tenuto) {
    parts.push('tenuto')
  }
  return parts.length ? parts.join('+') : 'none'
}
