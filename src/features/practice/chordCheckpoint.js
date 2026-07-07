import { midiToNoteLabel } from '../midi-input/midiNoteLabel.js'

export const CHORD_CHECKPOINT_KIND = {
  NOTE: 'note',
  DOUBLE_STOP: 'doubleStop',
  CHORD: 'chord',
  CHORD_SHAPE: 'chordShape',
}

export const DEFAULT_CHORD_ROLLING_WINDOW_MS = 500

const NOTE_LIKE_KINDS = new Set(Object.values(CHORD_CHECKPOINT_KIND))

export function isPlayableCheckpointKind(kind) {
  return NOTE_LIKE_KINDS.has(kind)
}

export function resolveChordCheckpointKind(expectedMidis = [], { chordShape = false } = {}) {
  const toneCount = expectedMidis?.length ?? 0
  if (chordShape && toneCount > 1) {
    return CHORD_CHECKPOINT_KIND.CHORD_SHAPE
  }
  if (toneCount === 2) {
    return CHORD_CHECKPOINT_KIND.DOUBLE_STOP
  }
  if (toneCount > 2) {
    return CHORD_CHECKPOINT_KIND.CHORD
  }
  return CHORD_CHECKPOINT_KIND.NOTE
}

export function defaultMinimumRequiredTones(kind, toneCount) {
  if (kind === CHORD_CHECKPOINT_KIND.NOTE) {
    return Math.min(1, toneCount)
  }
  return Math.max(0, toneCount)
}

export function defaultChordDisplayLabel({
  kind,
  expectedMidis = [],
  chordSymbol = null,
} = {}) {
  const toneCount = expectedMidis.length
  if (kind === CHORD_CHECKPOINT_KIND.NOTE) {
    return toneCount === 1 ? midiToNoteLabel(expectedMidis[0]) : null
  }
  if (chordSymbol) {
    return `Play ${chordSymbol} chord`
  }
  if (kind === CHORD_CHECKPOINT_KIND.DOUBLE_STOP) {
    return 'Play this double-stop'
  }
  return `Play ${toneCount}-note chord`
}

export function formatExpectedStringFret(entry) {
  if (!entry) {
    return null
  }
  const string = Number(entry.string)
  const fret = Number(entry.fret)
  if (!Number.isFinite(string) || !Number.isFinite(fret)) {
    return null
  }
  const noteLabel = Number.isFinite(entry.midi) ? `${midiToNoteLabel(entry.midi)} on ` : ''
  const fretLabel = fret === 0 ? 'open' : `fret ${fret}`
  return `${noteLabel}string ${string}, ${fretLabel}`
}

export function buildCheckpointDetails({
  expectedMidis = [],
  expectedStringFrets = [],
} = {}) {
  const stringFretDetails = expectedStringFrets
    .map(formatExpectedStringFret)
    .filter(Boolean)
  if (stringFretDetails.length) {
    return stringFretDetails.join('; ')
  }
  return expectedMidis
    .filter((midi) => Number.isFinite(midi))
    .map((midi) => midiToNoteLabel(midi))
    .join(', ')
}

export function buildChordCheckpointModel({
  expectedMidis = [],
  expectedStringFrets = [],
  chordSymbol = null,
  chordShape = false,
  minimumRequiredTones = null,
  rollingWindowMs = DEFAULT_CHORD_ROLLING_WINDOW_MS,
  isTiedContinuation = false,
  displayLabel = null,
} = {}) {
  const kind = resolveChordCheckpointKind(expectedMidis, { chordShape })
  const toneCount = expectedMidis.length
  const resolvedMinimum =
    Number.isFinite(Number(minimumRequiredTones))
      ? Math.max(0, Math.min(toneCount, Math.round(Number(minimumRequiredTones))))
      : defaultMinimumRequiredTones(kind, toneCount)
  const resolvedRollingWindow =
    Number.isFinite(Number(rollingWindowMs)) && Number(rollingWindowMs) > 0
      ? Number(rollingWindowMs)
      : DEFAULT_CHORD_ROLLING_WINDOW_MS

  return {
    kind,
    expectedMidis,
    expectedStringFrets,
    chordSymbol,
    minimumRequiredTones: resolvedMinimum,
    rollingWindowMs: resolvedRollingWindow,
    isTiedContinuation: Boolean(isTiedContinuation),
    displayLabel:
      displayLabel ??
      (toneCount > 1
        ? defaultChordDisplayLabel({ kind, expectedMidis, chordSymbol })
        : null),
    detailsLabel: buildCheckpointDetails({ expectedMidis, expectedStringFrets }),
  }
}
