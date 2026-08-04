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
      (group) =>
        group.clef === (note.clef ?? 'treble') &&
        Math.abs(group.cx - note.cx) <= OMR_CHORD_MERGE_X,
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
        clef: note.clef ?? 'treble',
        positionInMeasure: note.positionInMeasure,
      })
    }
  }

  return chords
}

function noteStaffSpace(note, imageHeight) {
  const lines = [...(note?.pitchMapping?.lineYs ?? [])]
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (lines.length < 2) return 8
  return ((lines.at(-1) - lines[0]) * imageHeight) / (lines.length - 1)
}

/**
 * A legacy raster window can sample the far tip of a real stem as another
 * notehead. When that recovery points back to the exact stem already owned by
 * a morphology note in the opposite direction, retain the morphology owner.
 */
export function filterRecoveredStemFragments(noteheads, imageHeight) {
  return noteheads.filter((candidate) => {
    if (!candidate?.detectionEvidence?.recoveredBy || !candidate.stem) return true
    const staffSpace = noteStaffSpace(candidate, imageHeight)
    const owner = noteheads.find((note) => {
      if (
        note === candidate ||
        note.clef !== candidate.clef ||
        note?.detectionEvidence?.source !== 'raster-morphology-core' ||
        !note.stem ||
        note.stem.direction === candidate.stem.direction
      ) {
        return false
      }
      const dx = Math.abs(note.cx - candidate.cx)
      return (
        dx >= staffSpace * 0.55 &&
        dx <= staffSpace * 1.5 &&
        Math.abs(note.stem.x - candidate.stem.x) <= 1 &&
        Math.abs(candidate.stem.tipY - note.cy) <= staffSpace * 0.28
      )
    })
    return !owner
  })
}

function laneKey(event) {
  return event?.clef ?? event?.notes?.[0]?.clef ?? 'treble'
}

function sortParallelStaffEvents(events) {
  return [...events].sort(
    (left, right) =>
      left.startDivision - right.startDivision ||
      Number(laneKey(left) === 'bass') - Number(laneKey(right) === 'bass') ||
      (left.cx ?? 0) - (right.cx ?? 0),
  )
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
  void measureWidth
  return events.map((event) => {
    const raw = Math.round(event.positionInMeasure * OMR_MEASURE_DIVISIONS)
    const snapped = Math.max(0, Math.min(OMR_MEASURE_DIVISIONS - 1, raw))
    return {
      ...event,
      startDivision: snapped,
    }
  })
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function alignLaneToReference(laneChords, referenceEvents) {
  const references = [...referenceEvents]
    .filter(
      (event) =>
        Number.isFinite(event.cx) && Number.isFinite(event.startDivision),
    )
    .sort((left, right) => left.cx - right.cx)
  if (!references.length) return null
  const gaps = references
    .slice(1)
    .map((event, index) => event.cx - references[index].cx)
    .filter((gap) => gap > 2)
  const tolerance = Math.max(6, (median(gaps) ?? 24) * 0.3)
  const usedStarts = new Set()
  const aligned = []
  for (const chord of [...laneChords].sort((left, right) => left.cx - right.cx)) {
    const nearest = references
      .map((event) => ({ event, distance: Math.abs(event.cx - chord.cx) }))
      .sort((left, right) => left.distance - right.distance)[0]
    if (
      !nearest ||
      nearest.distance > tolerance ||
      usedStarts.has(nearest.event.startDivision)
    ) {
      return null
    }
    usedStarts.add(nearest.event.startDivision)
    aligned.push({
      ...chord,
      startDivision: nearest.event.startDivision,
      rhythmPacking: 'cross-staff-column-aligned',
    })
  }
  return aligned
}

function preservingLaneFallback(laneChords, measureBox) {
  const sorted = [...laneChords].sort((left, right) => left.cx - right.cx)
  const count = Math.max(1, sorted.length)
  const starts = sorted.map((_, index) =>
    Math.floor((index * OMR_MEASURE_DIVISIONS) / count),
  )
  return sorted.map((chord, index) => {
    const nextStart = starts[index + 1] ?? OMR_MEASURE_DIVISIONS
    const available = Math.max(1, nextStart - starts[index])
    const durationDivisions = Math.min(
      Math.max(1, chord.durationDivisions ?? OMR_DURATION_DIVISIONS.quarter),
      available,
    )
    return {
      ...chord,
      startDivision: starts[index],
      durationDivisions,
      durationType:
        durationDivisions >= OMR_DURATION_DIVISIONS.half
          ? 'half'
          : durationDivisions >= OMR_DURATION_DIVISIONS.quarter
            ? 'quarter'
            : durationDivisions >= OMR_DURATION_DIVISIONS.eighth
              ? 'eighth'
              : 'sixteenth',
      confidence: Math.min(chord.confidence ?? 1, OMR_MEASURE_FALLBACK_THRESHOLD),
      uncertain: true,
      measureNumber: measureBox.measureNumber,
      page: measureBox.page,
      rhythmPacking: 'preserving-even-lane-fallback',
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
 * Pack grand-staff raster events independently by staff. A shared sequential
 * cursor drops the lower staff as an overlap whenever treble and bass sound at
 * the same time; independent lanes preserve both visible voices and let the
 * MusicXML serializer emit the required backup cursor.
 */
export function packRasterStaffLanes(chords, measureBox) {
  const lanes = new Map()
  for (const chord of chords) {
    const key = laneKey(chord)
    const entries = lanes.get(key) ?? []
    entries.push(chord)
    lanes.set(key, entries)
  }

  const meterCompleteLanes = new Map()
  for (const [clef, laneChords] of lanes) {
    const totalDuration = laneChords.reduce(
      (sum, chord) => sum + chord.durationDivisions,
      0,
    )
    if (totalDuration === OMR_MEASURE_DIVISIONS) {
      meterCompleteLanes.set(clef, packEventsSequentially(laneChords))
    }
  }
  let referenceEvents = [...meterCompleteLanes.values()].flat()

  const laneResults = []
  const orderedLanes = [...lanes.entries()].sort(
    ([leftClef, left], [rightClef, right]) =>
      Number(meterCompleteLanes.has(rightClef)) -
        Number(meterCompleteLanes.has(leftClef)) ||
      right.length - left.length,
  )
  for (const [clef, laneChords] of orderedLanes) {
    const totalDuration = laneChords.reduce(
      (sum, chord) => sum + chord.durationDivisions,
      0,
    )
    let laneEvents = meterCompleteLanes.get(clef) ??
      alignLaneToReference(laneChords, referenceEvents) ??
      assignStartDivisions(laneChords)
    let validation = validateAndNormalizeMeasureRhythm(laneEvents)
    laneEvents = validation.normalizedEvents
    const avgConfidence = laneChords.length
      ? laneChords.reduce((sum, chord) => sum + chord.confidence, 0) / laneChords.length
      : 0
    if (validation.overfill || avgConfidence < OMR_MEASURE_FALLBACK_THRESHOLD) {
      validation = validateAndNormalizeMeasureRhythm(
        buildEvenQuarterFallback(laneChords, measureBox),
      )
      laneEvents = validation.normalizedEvents
      validation = { ...validation, fallback: 'even-quarters', uncertain: true }
    }
    // Measure validation must never reduce a detected chord set. If ambiguous
    // geometry overlaps, retain every visible column on a marked uncertain
    // lane and shorten only as much as the finite measure grid requires.
    if (laneEvents.length !== laneChords.length) {
      validation = validateAndNormalizeMeasureRhythm(
        preservingLaneFallback(laneChords, measureBox),
      )
      laneEvents = validation.normalizedEvents
      validation = {
        ...validation,
        fallback: 'preserving-even-lane',
        uncertain: true,
      }
    }
    const coversMeasure =
      laneEvents.length === laneChords.length &&
      laneEvents.some((event) => event.startDivision === 0) &&
      Math.max(
        ...laneEvents.map(
          (event) => event.startDivision + event.durationDivisions,
        ),
      ) === OMR_MEASURE_DIVISIONS
    if (coversMeasure && !referenceEvents.some((event) => laneKey(event) === clef)) {
      referenceEvents = [...referenceEvents, ...laneEvents]
    }
    laneResults.push({ clef, events: laneEvents, validation })
  }

  const events = sortParallelStaffEvents(laneResults.flatMap((lane) => lane.events))
  const uncertain = laneResults.some((lane) => lane.validation.uncertain)
  return {
    events,
    uncertain,
    validation: {
      valid: laneResults.every((lane) => lane.validation.valid),
      uncertain,
      overfill: laneResults.some((lane) => lane.validation.overfill),
      lanes: Object.fromEntries(
        laneResults.map((lane) => [lane.clef, lane.validation]),
      ),
      packing: 'independent-staff-lanes',
    },
  }
}

/**
 * Turn raw noteheads into validated rhythmic events for one measure.
 */
export function assembleMeasureRhythm(
  imageData,
  measureBox,
  noteheads,
  inkThreshold,
  { captureDetectorObservations = false } = {},
) {
  const bounds = contentPixelBounds(imageData, {
    x0: measureBox.playableX0 ?? measureBox.x0,
    x1: measureBox.x1,
    y0: measureBox.y0,
    y1: measureBox.y1,
  })

  const enriched = filterRecoveredStemFragments(
    noteheads.map((notehead) =>
      enrichNoteheadRhythm(imageData, notehead, measureBox, inkThreshold, bounds),
    ),
    imageData.height,
  )

  const rests = detectRestsInMeasure(imageData, measureBox, inkThreshold, enriched)
  const chords = groupNoteheadsIntoChords(enriched)
  const measureWidth = bounds.right - bounds.left + 1

  const chordClefs = new Set(chords.map(laneKey))
  if (chordClefs.size > 1) {
    const packed = packRasterStaffLanes(chords, measureBox)
    for (const event of packed.events) {
      if (event?.type !== 'note' || !Number.isFinite(event.startDivision)) continue
      for (const note of event.notes ?? []) {
        note.onsetDivisions = event.startDivision
        note.durationDivisions = event.durationDivisions
        note.durationType = event.durationType ?? note.durationType
        note.dotted = Boolean(event.dotted)
        note.rhythmPacking = 'independent-staff-lanes'
      }
    }
    return {
      ...packed,
      ...(captureDetectorObservations
        ? { detectorObservations: { noteheads: enriched, rests: [] } }
        : {}),
    }
  }

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

  // Stamp packed measure timing onto detector noteheads for independent V3.
  // This stays detector-local (chord merge + measure packing), not V2 MusicXML
  // replay. Without it, raster V3 inherits only geometric positionInMeasure and
  // cannot match V2 onset/duration on scans.
  for (const event of events) {
    if (event?.type !== 'note' || !Number.isFinite(event.startDivision)) continue
    for (const note of event.notes ?? []) {
      note.onsetDivisions = event.startDivision
      if (Number.isFinite(event.durationDivisions) && event.durationDivisions > 0) {
        note.durationDivisions = event.durationDivisions
        note.durationType = event.durationType ?? note.durationType
        note.dotted = Boolean(event.dotted)
      }
      note.rhythmPacking = uncertain ? 'even-quarter-fallback' : 'measure-packed'
    }
  }

  return {
    events,
    uncertain,
    validation,
    ...(captureDetectorObservations
      ? {
          // V3 receives detector-level symbols after chord-proximity merge and
          // measure packing stamps onset/duration onto surviving noteheads.
          detectorObservations: { noteheads: enriched, rests: filteredRests },
        }
      : {}),
  }
}
