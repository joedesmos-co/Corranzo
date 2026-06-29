import { resolveClefForY } from './pitchFromStaffPosition.js'
import { OMR_DIVISIONS_PER_QUARTER, OMR_DURATION_DIVISIONS } from './omrRhythmConstants.js'

/**
 * SMuFL rest glyphs for vector PDF text layers (Bravura / Bravura Text).
 * U+E4E5 is staccatissimo in Bravura Text — never treat it as a rest glyph.
 */
const VECTOR_REST_GLYPHS = new Map([
  ['\ue4e3', { durationType: 'whole' }],
  ['\ue4e4', { durationType: 'half' }],
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

  const gap = findGapContaining(intervals, preferredStart, totalDivisions)
  if (!gap) {
    return { applied: false, reason: VECTOR_REST_SKIP_REASONS.NO_STAFF_GAP }
  }

  const startDivision = Math.max(
    gap.gapStart,
    Math.min(gap.gapEnd - 1, preferredStart),
  )
  if (startDivision < gap.gapStart || startDivision >= gap.gapEnd) {
    return { applied: false, reason: VECTOR_REST_SKIP_REASONS.NO_STAFF_GAP }
  }

  const durationDivisions = gap.gapEnd - startDivision
  if (durationDivisions < 1) {
    return { applied: false, reason: VECTOR_REST_SKIP_REASONS.GAP_TOO_SMALL }
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
