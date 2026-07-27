/**
 * Piano practice instructions — describe what to do, not raw note counts.
 *
 * Never use guitar terms ("double-stop"). When tones span both staves, say
 * "both hands together" instead of "N-note chord".
 */

import { midiToNoteLabel } from '../midi-input/midiNoteLabel.js'
import { INSTRUMENT_IDS } from '../instruments/instruments.js'

export const PIANO_HAND_TEXTURE = Object.freeze({
  RIGHT_HAND_SINGLE: 'right-hand-single',
  RIGHT_HAND_INTERVAL: 'right-hand-interval',
  RIGHT_HAND_CHORD: 'right-hand-chord',
  LEFT_HAND_SINGLE: 'left-hand-single',
  LEFT_HAND_INTERVAL: 'left-hand-interval',
  LEFT_HAND_CHORD: 'left-hand-chord',
  BOTH_HANDS: 'both-hands',
  UNKNOWN_SINGLE: 'unknown-single',
  UNKNOWN_INTERVAL: 'unknown-interval',
  UNKNOWN_CHORD: 'unknown-chord',
})

function uniqueFiniteMidis(values) {
  const seen = new Set()
  const midis = []
  for (const value of values ?? []) {
    const midi = Number(value)
    if (!Number.isFinite(midi) || seen.has(midi)) {
      continue
    }
    seen.add(midi)
    midis.push(midi)
  }
  return midis
}

function staffSetFromNotes(notes) {
  const staves = new Set()
  for (const note of notes ?? []) {
    if (note?.staff === 1 || note?.staff === 2) {
      staves.add(note.staff)
    }
  }
  return staves
}

/**
 * Classify a checkpoint by hand layout on the grand staff.
 * staff 1 ≈ right hand (treble), staff 2 ≈ left hand (bass).
 */
export function classifyPianoHandTexture(checkpoint = {}) {
  const midis = uniqueFiniteMidis(
    checkpoint.expectedMidis?.length
      ? checkpoint.expectedMidis
      : (checkpoint.notes ?? []).map((note) => note?.midi),
  )
  const toneCount = midis.length
  const staves = staffSetFromNotes(checkpoint.notes)

  if (staves.has(1) && staves.has(2)) {
    return PIANO_HAND_TEXTURE.BOTH_HANDS
  }

  const rightOnly = staves.size === 1 && staves.has(1)
  const leftOnly = staves.size === 1 && staves.has(2)

  if (toneCount <= 1) {
    if (rightOnly) return PIANO_HAND_TEXTURE.RIGHT_HAND_SINGLE
    if (leftOnly) return PIANO_HAND_TEXTURE.LEFT_HAND_SINGLE
    return PIANO_HAND_TEXTURE.UNKNOWN_SINGLE
  }

  if (toneCount === 2) {
    if (rightOnly) return PIANO_HAND_TEXTURE.RIGHT_HAND_INTERVAL
    if (leftOnly) return PIANO_HAND_TEXTURE.LEFT_HAND_INTERVAL
    return PIANO_HAND_TEXTURE.UNKNOWN_INTERVAL
  }

  if (rightOnly) return PIANO_HAND_TEXTURE.RIGHT_HAND_CHORD
  if (leftOnly) return PIANO_HAND_TEXTURE.LEFT_HAND_CHORD
  return PIANO_HAND_TEXTURE.UNKNOWN_CHORD
}

/**
 * Natural instructional text for piano Wait For You / visual targets.
 */
export function buildPianoPracticeInstruction(checkpoint = {}) {
  const midis = uniqueFiniteMidis(
    checkpoint.expectedMidis?.length
      ? checkpoint.expectedMidis
      : (checkpoint.notes ?? []).map((note) => note?.midi),
  )
  const texture = classifyPianoHandTexture({ ...checkpoint, expectedMidis: midis })
  const chordSymbol =
    typeof checkpoint.chordSymbol === 'string' && checkpoint.chordSymbol.trim()
      ? checkpoint.chordSymbol.trim()
      : null
  const namedChord = chordSymbol ? `Play the ${chordSymbol} chord` : 'Play the chord'
  const singleLabel = midis.length === 1 ? midiToNoteLabel(midis[0]) : null

  switch (texture) {
    case PIANO_HAND_TEXTURE.RIGHT_HAND_SINGLE:
    case PIANO_HAND_TEXTURE.UNKNOWN_SINGLE:
      return singleLabel ? `Play ${singleLabel}` : 'Play the note'

    case PIANO_HAND_TEXTURE.LEFT_HAND_SINGLE:
      return 'Play the left-hand note'

    case PIANO_HAND_TEXTURE.RIGHT_HAND_INTERVAL:
    case PIANO_HAND_TEXTURE.UNKNOWN_INTERVAL:
      return 'Play both notes together'

    case PIANO_HAND_TEXTURE.LEFT_HAND_INTERVAL:
      return 'Play both left-hand notes together'

    case PIANO_HAND_TEXTURE.RIGHT_HAND_CHORD:
    case PIANO_HAND_TEXTURE.UNKNOWN_CHORD:
      return namedChord

    case PIANO_HAND_TEXTURE.LEFT_HAND_CHORD:
      return chordSymbol ? `Play the left-hand ${chordSymbol} chord` : 'Play the left-hand chord'

    case PIANO_HAND_TEXTURE.BOTH_HANDS:
      return 'Play both hands together'

    default:
      return singleLabel ? `Play ${singleLabel}` : 'Play the notes'
  }
}

export function isPianoInstrumentId(instrumentId) {
  return instrumentId === INSTRUMENT_IDS.PIANO
}
