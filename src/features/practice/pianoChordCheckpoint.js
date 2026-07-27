import { enrichGuitarChordCheckpoint } from './guitarChordShapeCheckpoint.js'
import {
  buildPianoPracticeInstruction,
  classifyPianoHandTexture,
  isPianoInstrumentId,
} from './pianoPracticeInstructions.js'

/**
 * Piano chord checkpoints: multi-note targets use the same rolling mic
 * collection path as guitar chord shapes (V2 score-informed tones in a window).
 * Instruction text uses piano pedagogy (never "double-stop" / raw note counts).
 */

export const PIANO_CHORD_ROLLING_WINDOW_MS = 900

export {
  buildPianoPracticeInstruction,
  classifyPianoHandTexture,
  isPianoInstrumentId,
} from './pianoPracticeInstructions.js'

export function isPianoChordRollingCandidate(checkpoint, { instrumentId = null } = {}) {
  return (
    isPianoInstrumentId(instrumentId) &&
    Boolean(checkpoint?.isChord) &&
    (checkpoint?.expectedMidis?.length ?? 0) > 1
  )
}

/**
 * Stamp piano instructional copy onto any piano checkpoint (single or multi).
 * Always overwrites guitar-style labels such as "double-stop" / "N-note chord".
 */
export function enrichPianoPracticeCheckpoint(checkpoint, { instrumentId = null } = {}) {
  if (!checkpoint || !isPianoInstrumentId(instrumentId)) {
    return checkpoint
  }

  const pianoHandTexture = classifyPianoHandTexture(checkpoint)
  const displayLabel = buildPianoPracticeInstruction(checkpoint)
  const toneCount = checkpoint.expectedMidis?.length ?? 0

  if (!isPianoChordRollingCandidate(checkpoint, { instrumentId })) {
    return {
      ...checkpoint,
      pianoHandTexture,
      displayLabel,
      label: displayLabel,
    }
  }

  return {
    ...checkpoint,
    isRollingChordMic: true,
    isPianoChordMic: true,
    pianoHandTexture,
    displayLabel,
    label: displayLabel,
    rollingWindowMs: PIANO_CHORD_ROLLING_WINDOW_MS,
    minimumRequiredTones: toneCount,
    minimumChordTonesRequired: toneCount,
  }
}

/** @deprecated Prefer enrichPianoPracticeCheckpoint — kept for existing imports. */
export function enrichPianoChordCheckpoint(checkpoint, { instrumentId = null } = {}) {
  return enrichPianoPracticeCheckpoint(checkpoint, { instrumentId })
}

export function enrichWfyChordCheckpoint(checkpoint, { instrumentId = null, tabPositions = null } = {}) {
  const guitarEnriched = enrichGuitarChordCheckpoint(checkpoint, { instrumentId, tabPositions })
  return enrichPianoPracticeCheckpoint(guitarEnriched, { instrumentId })
}
