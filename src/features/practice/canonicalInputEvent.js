/**
 * CORRANZO V1 — Canonical live-input event contract (B03/B06).
 *
 * Every input source (MIDI, microphone/pitch, test/synthetic, manual) is
 * normalized to this shape BEFORE evaluation. No input source may bypass the
 * canonical evaluator with a pitch-only shortcut.
 *
 * Canonical input event:
 * - id: stable per-attack id (`in-<source>-<counter>-<wallMs>`)
 * - source: 'midi' | 'microphone' | 'synthetic' | 'manual'
 * - scoreTimeSeconds: authoritative score time at attack (getScoreTime() when
 *   playing; frozen manual time when paused). Null only for Wait For You,
 *   which is untimed by design (waits indefinitely).
 * - wallTimestampMs: performance.now()/Date.now() at capture (diagnostics,
 *   chord rolling windows, latency measurement).
 * - rawTimestamp: source-provided timestamp when available (MIDI event time).
 * - midi: observed pitch (integer MIDI) or null when no pitch.
 * - detectedMidis: full detected set for polyphonic mic frames.
 * - velocityOrConfidence: 0..1 or MIDI velocity 0..127 (source-labeled).
 * - kind: 'attack' (note-on / fresh pitch onset). Releases are observed for
 *   latch/rearm but never advance checkpoints by themselves.
 * - chordGroupId: groups simultaneous attacks (same tick / same frame).
 * - attemptId / iterationIndex: copied from the practice attempt at capture
 *   so late callbacks from a prior attempt cannot rewrite a new one.
 *
 * Evaluation entry: `evaluateCanonicalPracticeInput` routes Play Along
 * through the bounded timing evaluator and Wait For You through pitch
 * matching — both from this single normalized shape.
 */
import {
  evaluatePlayAlongNoteInput,
  resolvePlayAlongTargetIndex,
} from './playAlongLaneFeedback.js'
import {
  evaluateNoteInput,
  MATCH_OUTCOME,
} from './waitForYouNoteMatch.js'
import { VISUAL_LANE_OUTCOME } from './visualLaneFeedback.js'

export const INPUT_SOURCE = {
  MIDI: 'midi',
  MICROPHONE: 'microphone',
  SYNTHETIC: 'synthetic',
  MANUAL: 'manual',
}

let inputEventCounter = 0

export function createCanonicalInputEvent({
  source = INPUT_SOURCE.SYNTHETIC,
  scoreTimeSeconds = null,
  wallTimestampMs = null,
  rawTimestamp = null,
  midi = null,
  detectedMidis = null,
  velocityOrConfidence = null,
  kind = 'attack',
  chordGroupId = null,
  attemptId = null,
  iterationIndex = 0,
} = {}) {
  inputEventCounter += 1
  const wall = Number.isFinite(Number(wallTimestampMs))
    ? Number(wallTimestampMs)
    : Date.now()
  return {
    id: `in-${source}-${inputEventCounter}-${Math.round(wall)}`,
    source,
    scoreTimeSeconds: scoreTimeSeconds == null ? null : Number(scoreTimeSeconds),
    wallTimestampMs: wall,
    rawTimestamp: rawTimestamp ?? null,
    midi: midi == null ? null : Number(midi),
    detectedMidis: Array.isArray(detectedMidis) ? [...detectedMidis] : null,
    velocityOrConfidence: velocityOrConfidence ?? null,
    kind,
    chordGroupId: chordGroupId ?? null,
    attemptId: attemptId ?? null,
    iterationIndex,
  }
}

export function normalizeMidiInputEvent(midi, options = {}) {
  return createCanonicalInputEvent({
    source: INPUT_SOURCE.MIDI,
    scoreTimeSeconds: options.scoreTimeSeconds ?? null,
    wallTimestampMs: options.wallTimestampMs ?? Date.now(),
    rawTimestamp: options.rawTimestamp ?? null,
    midi,
    velocityOrConfidence: options.velocity ?? null,
    kind: options.kind ?? 'attack',
    chordGroupId: options.chordGroupId ?? null,
    attemptId: options.attemptId ?? null,
    iterationIndex: options.iterationIndex ?? 0,
  })
}

export function normalizeMicrophoneInputEvent({ midi = null, detectedMidis = null } = {}, options = {}) {
  return createCanonicalInputEvent({
    source: INPUT_SOURCE.MICROPHONE,
    scoreTimeSeconds: options.scoreTimeSeconds ?? null,
    wallTimestampMs: options.wallTimestampMs ?? Date.now(),
    rawTimestamp: options.rawTimestamp ?? null,
    midi,
    detectedMidis,
    velocityOrConfidence: options.confidence ?? null,
    kind: options.kind ?? 'attack',
    chordGroupId: options.chordGroupId ?? null,
    attemptId: options.attemptId ?? null,
    iterationIndex: options.iterationIndex ?? 0,
  })
}

export function normalizeSyntheticInputEvent(midi, options = {}) {
  return createCanonicalInputEvent({
    source: INPUT_SOURCE.SYNTHETIC,
    scoreTimeSeconds: options.scoreTimeSeconds ?? null,
    wallTimestampMs: options.wallTimestampMs ?? Date.now(),
    rawTimestamp: null,
    midi,
    velocityOrConfidence: options.velocityOrConfidence ?? null,
    kind: options.kind ?? 'attack',
    chordGroupId: options.chordGroupId ?? null,
    attemptId: options.attemptId ?? null,
    iterationIndex: options.iterationIndex ?? 0,
  })
}

/**
 * Single evaluation entry for Play Along. Always bounded by the timing
 * window — returns a lane outcome or null (out of window / no target).
 * MIDI and synthetic inputs produce identical results for identical
 * (pitch, scoreTime) pairs by construction.
 */
export function evaluateCanonicalPlayAlongInput(feedbackState, groups, inputEvent, matchSettings = {}) {
  if (!inputEvent || inputEvent.kind !== 'attack') return null
  if (inputEvent.midi == null) return null
  const scoreTime = Number(inputEvent.scoreTimeSeconds)
  if (!Number.isFinite(scoreTime)) return null
  const targetIndex = resolvePlayAlongTargetIndex(groups, scoreTime)
  const outcome = evaluatePlayAlongNoteInput(
    feedbackState,
    groups,
    scoreTime,
    inputEvent.midi,
    matchSettings,
  )
  return outcome == null ? null : { outcome, targetIndex }
}

/**
 * Wait For You is untimed by design (it waits). Pitch matching only — but
 * still from the canonical event shape so source handling stays uniform.
 */
export function evaluateCanonicalWaitForYouInput(checkpoint, inputEvent, bufferState, matchSettings = {}) {
  if (!inputEvent || inputEvent.kind !== 'attack') {
    return { outcome: MATCH_OUTCOME.NO_EXPECTED, expected: [], matchedIndices: new Set(), isChord: false }
  }
  if (inputEvent.midi == null) {
    return { outcome: MATCH_OUTCOME.NO_EXPECTED, expected: [], matchedIndices: new Set(), isChord: false }
  }
  return evaluateNoteInput(checkpoint, inputEvent.midi, bufferState, matchSettings)
}

export { MATCH_OUTCOME, VISUAL_LANE_OUTCOME }
