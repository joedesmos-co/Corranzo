import { applyAlterToMidi, distanceToNearestStaffLine, midiToWrittenPitch } from './pitchFromStaffPosition.js'

const SHARP_STEPS = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
const FLAT_STEPS = ['B', 'E', 'A', 'D', 'G', 'C', 'F']

export function applyKeySignature(midi, fifths) {
  if (!Number.isFinite(midi) || !Number.isFinite(fifths) || fifths === 0) {
    return { midi, alter: null, source: 'none' }
  }
  const pitch = midiToWrittenPitch(midi)
  if (fifths > 0 && SHARP_STEPS.slice(0, fifths).includes(pitch.step)) {
    return { midi: applyAlterToMidi(midi, 1), alter: 1, source: 'key-signature' }
  }
  if (fifths < 0 && FLAT_STEPS.slice(0, Math.abs(fifths)).includes(pitch.step)) {
    return { midi: applyAlterToMidi(midi, -1), alter: -1, source: 'key-signature' }
  }
  return { midi, alter: null, source: 'none' }
}

export function accidentalStateKey(note) {
  const pitch = midiToWrittenPitch(note.naturalMidi)
  return `${note.clef}:${pitch.step}${pitch.octave}`
}

/**
 * Resolve written pitch with key signature, local accidentals, and measure carry.
 * Sharps/flats apply relative to the key-default pitch at that staff step.
 */
export function resolveMeasureNotePitch({
  naturalMidi,
  keySignature = null,
  localAccidental = null,
  carriedState = null,
}) {
  const fifths = keySignature?.fifths ?? 0
  const keyed = applyKeySignature(naturalMidi, fifths)
  const written = midiToWrittenPitch(naturalMidi)

  if (localAccidental) {
    if (localAccidental.alter === 0) {
      return {
        midi: naturalMidi,
        alter: null,
        pitchAlteration: {
          writtenPitch: written,
          naturalMidi,
          keySignatureFifths: fifths,
          keyAlteration: keyed.source === 'key-signature' ? keyed.alter : null,
          localAccidental: localAccidental.type ?? 'natural',
          localAccidentalAlter: 0,
          accidentalSource: localAccidental.glyph ? 'vector-glyph' : 'explicit',
          measureAccidentalState: { mode: 'natural' },
        },
        accidentalState: { mode: 'natural' },
      }
    }
    const midi = applyAlterToMidi(keyed.midi, localAccidental.alter)
    return {
      midi,
      alter: localAccidental.alter,
      pitchAlteration: {
        writtenPitch: written,
        naturalMidi,
        keySignatureFifths: fifths,
        keyDefaultMidi: keyed.midi,
        keyAlteration: keyed.source === 'key-signature' ? keyed.alter : null,
        localAccidental: localAccidental.type ?? (localAccidental.alter > 0 ? 'sharp' : 'flat'),
        localAccidentalAlter: localAccidental.alter,
        accidentalSource: localAccidental.glyph ? 'vector-glyph' : 'explicit',
        measureAccidentalState: { mode: 'explicit', alter: localAccidental.alter },
      },
      accidentalState: { mode: 'explicit', alter: localAccidental.alter },
    }
  }

  if (carriedState?.mode === 'natural') {
    return {
      midi: naturalMidi,
      alter: null,
      pitchAlteration: {
        writtenPitch: written,
        naturalMidi,
        keySignatureFifths: fifths,
        keyAlteration: null,
        localAccidental: null,
        measureAccidentalState: carriedState,
      },
      accidentalState: carriedState,
    }
  }

  if (carriedState?.mode === 'explicit') {
    const midi = applyAlterToMidi(keyed.midi, carriedState.alter)
    return {
      midi,
      alter: carriedState.alter,
      pitchAlteration: {
        writtenPitch: written,
        naturalMidi,
        keySignatureFifths: fifths,
        keyDefaultMidi: keyed.midi,
        keyAlteration: keyed.source === 'key-signature' ? keyed.alter : null,
        localAccidental: null,
        measureAccidentalState: carriedState,
      },
      accidentalState: carriedState,
    }
  }

  return {
    midi: keyed.midi,
    alter: keyed.alter,
    pitchAlteration: {
      writtenPitch: written,
      naturalMidi,
      keySignatureFifths: fifths,
      keyAlteration: keyed.source === 'key-signature' ? keyed.alter : null,
      localAccidental: null,
      measureAccidentalState: null,
    },
    accidentalState: null,
  }
}

/**
 * Resolve pitch with key signature, local glyph accidentals, and measure carry.
 * Local accidentals apply to the written natural pitch; carried accidentals apply
 * relative to the key-default pitch so repeated chromatic spellings stay correct.
 */
export function resolveNotePitchWithMeasureState({
  naturalMidi,
  keySignature = null,
  localAccidental = null,
  carriedAlter = null,
}) {
  const fifths = keySignature?.fifths ?? 0
  const keyedDefault = applyKeySignature(naturalMidi, fifths)
  const written = midiToWrittenPitch(naturalMidi)

  if (localAccidental) {
    if (localAccidental.alter === 0) {
      return {
        midi: naturalMidi,
        alter: null,
        measureAccidentalState: 0,
        pitchAlteration: {
          writtenPitch: written,
          naturalMidi,
          keySignatureFifths: fifths,
          keyDefaultMidi: keyedDefault.midi,
          keyAlteration: keyedDefault.alter,
          localAccidental: localAccidental.type ?? 'natural',
          localAccidentalAlter: 0,
          accidentalSource: localAccidental.glyph ? 'vector-glyph' : 'explicit',
          measureAccidentalState: 0,
        },
      }
    }
    return {
      midi: applyAlterToMidi(naturalMidi, localAccidental.alter),
      alter: localAccidental.alter,
      measureAccidentalState: localAccidental.alter,
      pitchAlteration: {
        writtenPitch: written,
        naturalMidi,
        keySignatureFifths: fifths,
        keyDefaultMidi: keyedDefault.midi,
        keyAlteration: keyedDefault.alter,
        localAccidental: localAccidental.type ?? (localAccidental.alter > 0 ? 'sharp' : 'flat'),
        localAccidentalAlter: localAccidental.alter,
        accidentalSource: localAccidental.glyph ? 'vector-glyph' : 'explicit',
        measureAccidentalState: localAccidental.alter,
      },
    }
  }

  if (carriedAlter != null) {
    if (carriedAlter === 0) {
      return {
        midi: naturalMidi,
        alter: null,
        measureAccidentalState: 0,
        pitchAlteration: {
          writtenPitch: written,
          naturalMidi,
          keySignatureFifths: fifths,
          keyDefaultMidi: keyedDefault.midi,
          keyAlteration: null,
          localAccidental: null,
          measureAccidentalState: 0,
        },
      }
    }
    return {
      midi: applyAlterToMidi(keyedDefault.midi, carriedAlter),
      alter: carriedAlter,
      measureAccidentalState: carriedAlter,
      pitchAlteration: {
        writtenPitch: written,
        naturalMidi,
        keySignatureFifths: fifths,
        keyDefaultMidi: keyedDefault.midi,
        keyAlteration: keyedDefault.alter,
        localAccidental: null,
        measureAccidentalState: carriedAlter,
      },
    }
  }

  return {
    midi: keyedDefault.midi,
    alter: keyedDefault.alter,
    measureAccidentalState: null,
    pitchAlteration: {
      writtenPitch: written,
      naturalMidi,
      keySignatureFifths: fifths,
      keyDefaultMidi: keyedDefault.midi,
      keyAlteration: keyedDefault.alter,
      localAccidental: null,
      measureAccidentalState: null,
    },
  }
}

function staffGapPixels(lineYs, imageData) {
  if (!lineYs?.length || !imageData?.height) {
    return 10
  }
  const sorted = [...lineYs].sort((a, b) => a - b)
  return Math.max(4, ((sorted[sorted.length - 1] - sorted[0]) / 4) * imageData.height)
}

export function accidentalMatchWindow(measureBox, lineYs, imageData) {
  const staffGap = staffGapPixels(lineYs, imageData)
  const maxDx = Math.max(24, staffGap * 3.2)
  const playableStart = (measureBox.playableX0 ?? measureBox.x0) * imageData.width
  return {
    maxDx,
    maxDy: Math.max(10, staffGap * 2.4),
    minX: Math.max(measureBox.x0 * imageData.width, playableStart - maxDx),
  }
}

export function accidentalMatchScore(note, glyph, window, lineYs, imageData) {
  const dx = note.cx - glyph.x
  if (dx <= 0 || dx > window.maxDx) {
    return null
  }
  const dy = Math.abs(note.cy - glyph.y)
  if (dy > window.maxDy) {
    return null
  }
  const noteLineDist = distanceToNearestStaffLine(note.yNorm, lineYs) * imageData.height
  const glyphLineDist =
    distanceToNearestStaffLine(glyph.y / imageData.height, lineYs) * imageData.height
  const lineMismatch = Math.abs(noteLineDist - glyphLineDist)
  return dx + dy * 2.5 + lineMismatch * 5
}

export function assignLocalAccidentals(glyphs, imageData, measureBox, notes, accidentalGlyphs) {
  const candidates = []

  for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex += 1) {
    const glyph = glyphs[glyphIndex]
    const accidental = accidentalGlyphs.get(glyph.text)
    if (!accidental) {
      continue
    }

    for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
      const note = notes[noteIndex]
      const lineYs =
        note.clef === 'treble' ? measureBox.staffLines.treble : measureBox.staffLines.bass
      const window = accidentalMatchWindow(measureBox, lineYs, imageData)
      if (glyph.x < window.minX) {
        continue
      }
      const score = accidentalMatchScore(note, glyph, window, lineYs, imageData)
      if (score == null) {
        continue
      }
      candidates.push({ glyphIndex, noteIndex, score, accidental, glyph })
    }
  }

  candidates.sort((left, right) => left.score - right.score)
  const assignments = new Map()
  const usedGlyphs = new Set()
  const usedNotes = new Set()

  for (const candidate of candidates) {
    if (usedGlyphs.has(candidate.glyphIndex) || usedNotes.has(candidate.noteIndex)) {
      continue
    }
    usedGlyphs.add(candidate.glyphIndex)
    usedNotes.add(candidate.noteIndex)
    assignments.set(candidate.noteIndex, {
      ...candidate.accidental,
      glyph: candidate.glyph,
      score: candidate.score,
      confidence: 0.9,
    })
  }

  return assignments
}
