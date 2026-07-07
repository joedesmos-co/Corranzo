import { INSTRUMENT_IDS } from '../instruments/instruments.js'
import { enrichGuitarChordCheckpoint } from './guitarChordShapeCheckpoint.js'
import {
  defaultChordDisplayLabel,
  resolveChordCheckpointKind,
} from './chordCheckpoint.js'

/**
 * Piano chord checkpoints: multi-note targets use the same rolling mic
 * collection path as guitar chord shapes (V2 score-informed tones in a window).
 */

export const PIANO_CHORD_ROLLING_WINDOW_MS = 900

export function isPianoChordRollingCandidate(checkpoint, { instrumentId = null } = {}) {
  return (
    instrumentId === INSTRUMENT_IDS.PIANO &&
    Boolean(checkpoint?.isChord) &&
    (checkpoint?.expectedMidis?.length ?? 0) > 1
  )
}

export function enrichPianoChordCheckpoint(checkpoint, { instrumentId = null } = {}) {
  if (!checkpoint || !isPianoChordRollingCandidate(checkpoint, { instrumentId })) {
    return checkpoint
  }
  const toneCount = checkpoint.expectedMidis?.length ?? 0
  const kind = resolveChordCheckpointKind(checkpoint.expectedMidis)
  const displayLabel =
    checkpoint.displayLabel ??
    defaultChordDisplayLabel({
      kind,
      expectedMidis: checkpoint.expectedMidis ?? [],
      chordSymbol: checkpoint.chordSymbol ?? null,
    })
  return {
    ...checkpoint,
    isRollingChordMic: true,
    isPianoChordMic: true,
    displayLabel,
    rollingWindowMs: PIANO_CHORD_ROLLING_WINDOW_MS,
    minimumRequiredTones: toneCount,
    minimumChordTonesRequired: toneCount,
  }
}

export function enrichWfyChordCheckpoint(checkpoint, { instrumentId = null, tabPositions = null } = {}) {
  const guitarEnriched = enrichGuitarChordCheckpoint(checkpoint, { instrumentId, tabPositions })
  return enrichPianoChordCheckpoint(guitarEnriched, { instrumentId })
}
