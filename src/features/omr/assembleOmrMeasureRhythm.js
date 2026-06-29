import { contentPixelBounds } from './omrInk.js'
import { enrichNoteheadRhythm } from './detectNoteRhythmFeatures.js'
import { detectRestsInMeasure } from './detectOmrRests.js'
import {
  OMR_CHORD_MERGE_X,
  OMR_DURATION_DIVISIONS,
  OMR_MEASURE_DIVISIONS,
  OMR_MEASURE_FALLBACK_THRESHOLD,
} from './omrRhythmConstants.js'
import { validateAndNormalizeMeasureRhythm } from './validateOmrMeasureRhythm.js'

function groupNoteheadsIntoChords(noteheads) {
  const sorted = [...noteheads].sort((a, b) => a.cx - b.cx)
  const chords = []

  for (const note of sorted) {
    const chord = chords.find(
      (group) => Math.abs(group.cx - note.cx) <= OMR_CHORD_MERGE_X,
    )
    if (chord) {
      chord.notes.push(note)
      chord.cx = Math.round(
        chord.notes.reduce((sum, item) => sum + item.cx, 0) / chord.notes.length,
      )
      chord.confidence = Math.min(chord.confidence, note.confidence)
      if (note.durationDivisions > chord.durationDivisions) {
        chord.durationDivisions = note.durationDivisions
        chord.durationType = note.durationType
      }
      chord.dotted = chord.dotted || note.dotted
      chord.tieStart = chord.tieStart || note.tieStart
      chord.beams = Math.max(chord.beams ?? 0, note.beams ?? 0)
    } else {
      chords.push({
        type: 'note',
        cx: note.cx,
        notes: [note],
        durationType: note.durationType,
        durationDivisions: note.durationDivisions,
        confidence: note.confidence,
        dotted: note.dotted,
        tieStart: note.tieStart,
        beams: note.beams ?? 0,
        measureNumber: note.measureNumber,
        page: note.page,
        positionInMeasure: note.positionInMeasure,
      })
    }
  }

  return chords
}

function packEventsSequentially(events) {
  const sorted = [...events].sort((a, b) => a.positionInMeasure - b.positionInMeasure)
  let cursor = 0
  return sorted.map((event) => {
    const packed = {
      ...event,
      startDivision: cursor,
    }
    cursor += event.durationDivisions
    return packed
  })
}

function assignStartDivisions(events, measureWidth) {
  return events.map((event) => {
    const raw = Math.round(event.positionInMeasure * OMR_MEASURE_DIVISIONS)
    const snapped = Math.max(0, Math.min(OMR_MEASURE_DIVISIONS - 1, raw))
    return {
      ...event,
      startDivision: snapped,
    }
  })
}

function buildEvenQuarterFallback(noteChords, measureBox) {
  const count = Math.max(1, noteChords.length)
  const slotWidth = OMR_MEASURE_DIVISIONS / count
  return noteChords.map((chord, index) => ({
    ...chord,
    type: 'note',
    durationType: 'quarter',
    durationDivisions: OMR_DURATION_DIVISIONS.quarter,
    confidence: OMR_MEASURE_FALLBACK_THRESHOLD,
    startDivision: Math.round(index * slotWidth),
    uncertain: true,
    measureNumber: measureBox.measureNumber,
    page: measureBox.page,
  }))
}

/**
 * Turn raw noteheads into validated rhythmic events for one measure.
 */
export function assembleMeasureRhythm(imageData, measureBox, noteheads, inkThreshold) {
  const bounds = contentPixelBounds(imageData, {
    x0: measureBox.playableX0 ?? measureBox.x0,
    x1: measureBox.x1,
    y0: measureBox.y0,
    y1: measureBox.y1,
  })

  const enriched = noteheads.map((notehead) =>
    enrichNoteheadRhythm(imageData, notehead, measureBox, inkThreshold, bounds),
  )

  const rests = detectRestsInMeasure(imageData, measureBox, inkThreshold, enriched)
  const chords = groupNoteheadsIntoChords(enriched)
  const measureWidth = bounds.right - bounds.left + 1

  const chordDuration = chords.reduce((sum, chord) => sum + chord.durationDivisions, 0)
  let filteredRests = []
  if (chordDuration <= OMR_MEASURE_DIVISIONS / 2) {
    filteredRests = rests.filter((rest) => {
      const nearChord = chords.some((chord) => Math.abs(chord.cx - rest.cx) <= 14)
      return !nearChord
    })
    const restDuration = filteredRests.reduce((sum, rest) => sum + rest.durationDivisions, 0)
    if (chordDuration + restDuration > OMR_MEASURE_DIVISIONS) {
      filteredRests = []
    }
  }

  const rawEvents = [...chords, ...filteredRests]
  const totalDuration = rawEvents.reduce(
    (sum, event) => sum + (event.durationDivisions ?? 4),
    0,
  )
  let events =
    totalDuration === OMR_MEASURE_DIVISIONS
      ? packEventsSequentially(rawEvents)
      : assignStartDivisions(chords, measureWidth)
  let validation = validateAndNormalizeMeasureRhythm(events)
  events = validation.normalizedEvents

  const avgConfidence = chords.length
    ? chords.reduce((sum, chord) => sum + chord.confidence, 0) / chords.length
    : 0

  let uncertain = validation.uncertain
  if (validation.overfill || avgConfidence < OMR_MEASURE_FALLBACK_THRESHOLD) {
    validation = validateAndNormalizeMeasureRhythm(buildEvenQuarterFallback(chords, measureBox))
    events = validation.normalizedEvents
    uncertain = true
    validation = { ...validation, fallback: 'even-quarters', uncertain: true }
  }

  return {
    events,
    uncertain,
    validation,
  }
}
