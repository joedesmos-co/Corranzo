import { resolveClefForY } from './pitchFromStaffPosition.js'
import { OMR_DIVISIONS_PER_QUARTER, OMR_DURATION_DIVISIONS } from './omrRhythmConstants.js'

/**
 * SMuFL rest glyphs for vector PDF text layers (Bravura / Bravura Text).
 * U+E4E5 is the SMuFL quarter rest. Articulations live in U+E4A0–U+E4BF,
 * so rest glyphs must never be reused as articulation evidence.
 */
const VECTOR_REST_GLYPHS = new Map([
  ['\ue4e3', { durationType: 'whole' }],
  ['\ue4e4', { durationType: 'half' }],
  ['\ue4e5', { durationType: 'quarter' }],
  ['\ue4e6', { durationType: 'eighth' }],
  ['\ue4e7', { durationType: 'sixteenth' }],
])

export const VECTOR_REST_SKIP_REASONS = {
  NEAR_NOTEHEAD: 'near-notehead',
  OVERLAPS_STAFF_NOTES: 'overlaps-staff-notes',
  WHOLE_REST_WITH_STAFF_NOTES: 'whole-rest-with-staff-notes',
  NO_STAFF_GAP: 'no-staff-gap',
  GAP_TOO_SMALL: 'gap-too-small',
  DUPLICATE_REST: 'duplicate-rest',
  UNSUPPORTED_WHOLE_REST: 'unsupported-whole-rest',
}

const NOTEHEAD_EXCLUSION_RADIUS = 10
const REST_DEDUPE_RADIUS = 8

function glyphInMeasureBox(glyph, measureBox, imageData, { yPad = 0.025 } = {}) {
  const xNorm = glyph.x / imageData.width
  const yNorm = glyph.y / imageData.height
  return (
    xNorm >= (measureBox.playableX0 ?? measureBox.x0) &&
    xNorm <= measureBox.x1 &&
    yNorm >= measureBox.y0 - yPad &&
    yNorm <= measureBox.y1 + yPad
  )
}

function nearNotehead(glyph, noteheads, radius = NOTEHEAD_EXCLUSION_RADIUS) {
  return noteheads.some(
    (note) =>
      Math.abs(note.cx - glyph.x) <= radius && Math.abs(note.cy - glyph.y) <= radius,
  )
}

function measurePosition(glyph, measureBox, imageData) {
  const left = (measureBox.playableX0 ?? measureBox.x0) * imageData.width
  const right = measureBox.x1 * imageData.width
  return (glyph.x - left) / Math.max(1, right - left)
}

function restDurationMeta(durationDivisions) {
  if (durationDivisions >= OMR_DURATION_DIVISIONS.whole) {
    return { durationType: 'whole', dotted: false }
  }
  if (durationDivisions >= OMR_DURATION_DIVISIONS.half) {
    return { durationType: 'half', dotted: false }
  }
  if (durationDivisions >= OMR_DIVISIONS_PER_QUARTER) {
    return { durationType: 'quarter', dotted: false }
  }
  if (durationDivisions >= OMR_DURATION_DIVISIONS.eighth) {
    return { durationType: 'eighth', dotted: false }
  }
  return { durationType: 'sixteenth', dotted: false }
}

function sortStaffAwareEvents(events) {
  return [...events].sort(
    (left, right) =>
      (left.startDivision ?? 0) - (right.startDivision ?? 0) ||
      (left.clef === 'bass' ? -1 : 1) - (right.clef === 'bass' ? -1 : 1),
  )
}

function staffNoteEvents(events, clef) {
  return events.filter(
    (event) =>
      event.type === 'note' &&
      (event.notes ?? []).length > 0 &&
      event.notes.every((note) => note.clef === clef),
  )
}

function staffRestEvents(events, clef) {
  return events.filter((event) => event.type === 'rest' && event.clef === clef)
}

function occupiedIntervals(staffEvents) {
  return staffEvents
    .map((event) => ({
      start: event.startDivision ?? 0,
      end: (event.startDivision ?? 0) + event.durationDivisions,
    }))
    .sort((left, right) => left.start - right.start)
}

function findGapContaining(intervals, division, totalDivisions) {
  let previousEnd = 0
  for (const interval of intervals) {
    if (division >= previousEnd && division < interval.start) {
      return { gapStart: previousEnd, gapEnd: interval.start }
    }
    previousEnd = Math.max(previousEnd, interval.end)
  }
  if (division >= previousEnd && division < totalDivisions) {
    return { gapStart: previousEnd, gapEnd: totalDivisions }
  }
  return null
}

function overlapsInterval(start, duration, intervals) {
  const end = start + duration
  return intervals.some((interval) => start < interval.end && end > interval.start)
}

function overlapsRest(start, duration, rests) {
  return rests.some((rest) => {
    const restStart = rest.startDivision ?? 0
    return start < restStart + rest.durationDivisions && start + duration > restStart
  })
}

function firstNoteOnStaff(events, clef) {
  const notes = staffNoteEvents(events, clef)
  if (!notes.length) {
    return null
  }
  return notes.reduce((best, event) =>
    (event.startDivision ?? 0) < (best.startDivision ?? 0) ? event : best,
  )
}

function firstNotePositionOnStaff(events, clef) {
  const first = firstNoteOnStaff(events, clef)
  if (!first) {
    return null
  }
  return (
    first.positionInMeasure ??
    first.notes?.[0]?.positionInMeasure ??
    null
  )
}

function createRestEvent(rest, startDivision, durationDivisions, measureBox) {
  return {
    type: 'rest',
    startDivision,
    durationDivisions,
    ...restDurationMeta(durationDivisions),
    confidence: rest.confidence ?? 0.88,
    measureNumber: measureBox.measureNumber,
    page: measureBox.page,
    positionInMeasure: rest.positionInMeasure,
    cx: rest.cx,
    clef: rest.clef,
    vector: true,
    source: 'vector-glyph',
    notationArticulations: rest.notationArticulations ?? [],
  }
}

function restDurationForEmptyStaff(rest, totalDivisions) {
  if (rest.durationType === 'whole') {
    return totalDivisions
  }
  const hinted = OMR_DURATION_DIVISIONS[rest.durationType] ?? OMR_DIVISIONS_PER_QUARTER
  return Math.min(totalDivisions, hinted)
}

function tryApplyStaffRest(events, rest, totalDivisions, measureBox) {
  const clef = rest.clef ?? 'treble'
  const notesOnStaff = staffNoteEvents(events, clef)
  const restsOnStaff = staffRestEvents(events, clef)
  const intervals = occupiedIntervals(notesOnStaff)

  if (rest.durationType === 'whole' && notesOnStaff.length > 0) {
    return { applied: false, reason: VECTOR_REST_SKIP_REASONS.WHOLE_REST_WITH_STAFF_NOTES }
  }

  if (notesOnStaff.length === 0) {
    const durationDivisions = restDurationForEmptyStaff(rest, totalDivisions)
    if (overlapsRest(0, durationDivisions, restsOnStaff)) {
      return { applied: false, reason: VECTOR_REST_SKIP_REASONS.DUPLICATE_REST }
    }
    return {
      applied: true,
      events: [...events, createRestEvent(rest, 0, durationDivisions, measureBox)],
    }
  }

  const preferredStart = Math.round(rest.positionInMeasure * totalDivisions)
  if (overlapsInterval(preferredStart, 1, intervals)) {
    return { applied: false, reason: VECTOR_REST_SKIP_REASONS.OVERLAPS_STAFF_NOTES }
  }

  const firstNotePosition = firstNotePositionOnStaff(events, clef)
  const firstNoteStart = firstNoteOnStaff(events, clef)?.startDivision ?? totalDivisions
  const openingPickupRest =
    Number.isFinite(firstNotePosition) &&
    rest.positionInMeasure + 0.02 < firstNotePosition &&
    rest.positionInMeasure < 0.35

  let gap = findGapContaining(intervals, preferredStart, totalDivisions)
  if (openingPickupRest) {
    const openingGap = findGapContaining(intervals, 0, totalDivisions)
    if (openingGap && openingGap.gapStart === 0 && openingGap.gapEnd > openingGap.gapStart) {
      gap = openingGap
    }
  }
  if (!gap) {
    return { applied: false, reason: VECTOR_REST_SKIP_REASONS.NO_STAFF_GAP }
  }

  let startDivision = Math.max(
    gap.gapStart,
    Math.min(gap.gapEnd - 1, preferredStart),
  )
  if (openingPickupRest && gap.gapStart === 0) {
    startDivision = 0
  }
  if (startDivision < gap.gapStart || startDivision >= gap.gapEnd) {
    return { applied: false, reason: VECTOR_REST_SKIP_REASONS.NO_STAFF_GAP }
  }

  const gapDuration = gap.gapEnd - startDivision
  if (gapDuration < 1) {
    return { applied: false, reason: VECTOR_REST_SKIP_REASONS.GAP_TOO_SMALL }
  }

  // Prefer the glyph's written duration when it fits the staff gap. Stretching
  // every rest to the full gap invents long rests and shifts later onsets.
  const glyphDuration =
    OMR_DURATION_DIVISIONS[rest.durationType] ?? OMR_DIVISIONS_PER_QUARTER
  let durationDivisions = Math.min(gapDuration, Math.max(1, glyphDuration))
  if (openingPickupRest && startDivision === 0) {
    durationDivisions = Math.min(
      glyphDuration,
      Math.max(1, firstNoteStart - startDivision),
      gapDuration,
    )
  }
  if (
    !openingPickupRest &&
    gapDuration >= OMR_DIVISIONS_PER_QUARTER &&
    durationDivisions < gapDuration &&
    gapDuration - durationDivisions <= OMR_DURATION_DIVISIONS.eighth
  ) {
    durationDivisions = gapDuration
  }

  if (overlapsRest(startDivision, durationDivisions, restsOnStaff)) {
    return { applied: false, reason: VECTOR_REST_SKIP_REASONS.DUPLICATE_REST }
  }

  return {
    applied: true,
    events: [...events, createRestEvent(rest, startDivision, durationDivisions, measureBox)],
  }
}

/**
 * When an opening pickup rest lands at the barline, shift delayed note onsets
 * left by the same pickup offset so the rest+attack grid matches the engraving.
 */
export function rebalanceOpeningPickupRests(events, totalDivisions) {
  const noteEvents = events.filter((event) => event.type === 'note')
  if (!noteEvents.length) {
    return events
  }
  const byClef = new Map()
  for (const event of noteEvents) {
    const clef = event.clef ?? event.notes?.[0]?.clef ?? 'treble'
    if (!byClef.has(clef)) {
      byClef.set(clef, [])
    }
    byClef.get(clef).push(event)
  }

  const shiftByEvent = new Map()
  for (const [clef, clefNotes] of byClef.entries()) {
    const openingRest = events.find(
      (event) =>
        event.type === 'rest' &&
        (event.clef ?? 'treble') === clef &&
        (event.startDivision ?? 0) === 0,
    )
    if (!openingRest) {
      continue
    }
    const restDuration = openingRest.durationDivisions ?? 0
    if (!(restDuration > 0)) {
      continue
    }
    const sortedNotes = [...clefNotes].sort(
      (left, right) => (left.startDivision ?? 0) - (right.startDivision ?? 0),
    )
    const firstStart = sortedNotes[0]?.startDivision ?? 0
    const firstPosition =
      sortedNotes[0]?.positionInMeasure ??
      sortedNotes[0]?.notes?.[0]?.positionInMeasure ??
      null
    if (
      firstStart <= restDuration ||
      firstStart > restDuration + OMR_DURATION_DIVISIONS.eighth + 1 ||
      !(Number.isFinite(firstPosition) && firstPosition < 0.35)
    ) {
      continue
    }
    const delta = firstStart - restDuration
    if (!(delta > 0)) {
      continue
    }
    for (const event of sortedNotes) {
      shiftByEvent.set(event, Math.max(0, (event.startDivision ?? 0) - delta))
    }
  }

  if (!shiftByEvent.size) {
    return events
  }

  return sortStaffAwareEvents(
    events.map((event) => {
      if (!shiftByEvent.has(event)) {
        return event
      }
      return {
        ...event,
        startDivision: shiftByEvent.get(event),
        openingPickupRestRebalanced: true,
      }
    }),
  )
}

/**
 * Append staff-local rest events without changing existing note event timing.
 */
export function insertMixedMeasureRests(noteEvents, rests, { measureBox, totalDivisions }) {
  let events = [...noteEvents]
  const skipped = []
  let appliedCount = 0

  for (const rest of rests) {
    const result = tryApplyStaffRest(events, rest, totalDivisions, measureBox)
    if (result.applied) {
      events = result.events
      appliedCount += 1
      continue
    }
    skipped.push({
      reason: result.reason,
      clef: rest.clef ?? 'treble',
      positionInMeasure: rest.positionInMeasure,
      durationType: rest.durationType,
    })
  }

  events = rebalanceOpeningPickupRests(events, totalDivisions)

  return {
    events: sortStaffAwareEvents(events),
    appliedCount,
    skipped,
  }
}

export function buildEmptyMeasureRestEvents(rests, measureBox, totalDivisions) {
  const mergedByClef = new Map()
  for (const rest of rests) {
    if (!mergedByClef.has(rest.clef)) {
      mergedByClef.set(rest.clef, rest)
    }
  }
  const events = [...mergedByClef.values()].map((rest) =>
    createRestEvent(rest, 0, restDurationForEmptyStaff(rest, totalDivisions), measureBox),
  )
  return sortStaffAwareEvents(events)
}

/**
 * Detect SMuFL rest glyphs in a measure, excluding rests that sit on noteheads
 * (staccato / articulation collisions in Bravura Text).
 */
export function restsForMeasure(glyphs, imageData, measureBox, noteheads = []) {
  const rests = []
  for (const glyph of glyphs ?? []) {
    const meta = VECTOR_REST_GLYPHS.get(glyph.text)
    if (!meta) {
      continue
    }
    if (!glyphInMeasureBox(glyph, measureBox, imageData)) {
      continue
    }
    if (nearNotehead(glyph, noteheads)) {
      continue
    }
    const duplicate = rests.some(
      (rest) =>
        Math.abs(rest.cx - glyph.x) <= REST_DEDUPE_RADIUS &&
        Math.abs(rest.cy - glyph.y) <= REST_DEDUPE_RADIUS,
    )
    if (duplicate) {
      continue
    }
    const yNorm = glyph.y / imageData.height
    rests.push({
      cx: glyph.x,
      cy: glyph.y,
      positionInMeasure: measurePosition(glyph, measureBox, imageData),
      durationType: meta.durationType,
      glyph: glyph.text,
      clef: resolveClefForY(yNorm, measureBox.staffLines).clef,
      source: 'vector-glyph',
      confidence: 0.88,
    })
  }
  return rests.sort((left, right) => left.cx - right.cx || left.cy - right.cy)
}

export function summarizeVectorRestDiagnostics(measureRecords = []) {
  let detectedRestGlyphCount = 0
  let appliedRestEventCount = 0
  let skippedMixedRestCount = 0
  const skippedReasons = {}

  for (const record of measureRecords) {
    detectedRestGlyphCount += record.vectorRestGlyphCount ?? 0
    const diagnostics = record.vectorRestDiagnostics ?? {}
    appliedRestEventCount += diagnostics.appliedCount ?? 0
    for (const entry of diagnostics.skipped ?? []) {
      skippedMixedRestCount += 1
      skippedReasons[entry.reason] = (skippedReasons[entry.reason] ?? 0) + 1
    }
  }

  return {
    detectedRestGlyphCount,
    appliedRestEventCount,
    skippedMixedRestCount,
    skippedReasons,
  }
}
