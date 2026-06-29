import {
  distanceToNearestStaffLine,
  resolvePitchFromGrandStaff,
} from './pitchFromStaffPosition.js'
import { vectorGlyphInMeasure } from './vectorGlyphMeasureBounds.js'

export const VECTOR_NOTEHEAD_GLYPHS = new Set(['\ue0a3', '\ue0a4', '\ue0a2'])

/** Horizontal slack for noteheads in the gap between systems. */
export const ORPHAN_INTER_SYSTEM_X_PAD = 0.025
/** Max normalized distance from a staff line for orphan acceptance. */
export const ORPHAN_MAX_STAFF_DIST = 0.02
/** Min margin between best and second-best system staff distance. */
export const ORPHAN_SYSTEM_AMBIGUITY_MARGIN = 0.008

export const ORPHAN_REJECTION = {
  NOT_NOTEHEAD: 'not-notehead',
  ALREADY_ASSIGNED: 'already-assigned',
  AMBIGUOUS_SYSTEM: 'ambiguous-system',
  FAR_FROM_STAFF: 'far-from-staff',
  NO_MEASURE: 'no-measure',
  FAR_FROM_MEASURE_X: 'far-from-measure-x',
  PITCH_NULL: 'pitch-null',
}

export function noteheadGlyphKey(glyph) {
  const x = glyph?.x ?? 0
  const y = glyph?.y ?? 0
  const cx = Math.round(x / 4)
  const cy = Math.round(y / 4)
  return `${glyph?.text ?? ''}:${cx}:${cy}`
}

export function collectAssignedNoteheadGlyphKeys(glyphs, systemMeasureBoxes, imageData) {
  const keys = new Set()
  for (let systemIndex = 0; systemIndex < systemMeasureBoxes.length; systemIndex += 1) {
    const boxes = systemMeasureBoxes[systemIndex] ?? []
    for (let measureIndex = 0; measureIndex < boxes.length; measureIndex += 1) {
      const measureBox = boxes[measureIndex]
      const placement = { isLastInSystem: measureIndex === boxes.length - 1 }
      for (const glyph of glyphs) {
        if (!VECTOR_NOTEHEAD_GLYPHS.has(glyph.text)) {
          continue
        }
        if (vectorGlyphInMeasure(glyph, measureBox, imageData, placement)) {
          keys.add(noteheadGlyphKey(glyph))
        }
      }
    }
  }
  return keys
}

function staffDistanceForMeasure(yNorm, measureBox) {
  const treble = distanceToNearestStaffLine(yNorm, measureBox.staffLines?.treble ?? [])
  const bass = distanceToNearestStaffLine(yNorm, measureBox.staffLines?.bass ?? [])
  return Math.min(treble, bass)
}

function systemStaffDistance(yNorm, boxes) {
  if (!boxes.length) {
    return Infinity
  }
  return staffDistanceForMeasure(yNorm, boxes[0])
}

export function orphanHorizontalDistance(xNorm, measureBox, { isFirstInSystem = false, isLastInSystem = false } = {}) {
  const leftPad = isFirstInSystem ? ORPHAN_INTER_SYSTEM_X_PAD : 0
  const rightPad = isLastInSystem ? ORPHAN_INTER_SYSTEM_X_PAD : 0
  const left = measureBox.x0 - leftPad
  const right = measureBox.x1 + rightPad
  if (xNorm >= left && xNorm <= right) {
    return 0
  }
  if (xNorm < left) {
    return left - xNorm
  }
  return xNorm - right
}

function resolveOrphanMeasureCandidate({
  xNorm,
  yNorm,
  systemMeasureBoxes,
  staffClefsBySystem,
}) {
  const systemScores = systemMeasureBoxes.map((boxes, systemIndex) => ({
    systemIndex,
    staffDistance: systemStaffDistance(yNorm, boxes),
    staffClefs: staffClefsBySystem.get(systemIndex) ?? null,
  }))
  systemScores.sort((left, right) => left.staffDistance - right.staffDistance)
  const best = systemScores[0]
  const second = systemScores[1]
  if (!best || best.staffDistance > ORPHAN_MAX_STAFF_DIST) {
    return { reason: ORPHAN_REJECTION.FAR_FROM_STAFF }
  }
  if (
    second &&
    second.staffDistance - best.staffDistance < ORPHAN_SYSTEM_AMBIGUITY_MARGIN
  ) {
    return { reason: ORPHAN_REJECTION.AMBIGUOUS_SYSTEM }
  }

  const boxes = systemMeasureBoxes[best.systemIndex] ?? []
  let measureCandidate = null
  let measureDistance = Infinity
  for (let measureIndex = 0; measureIndex < boxes.length; measureIndex += 1) {
    const measureBox = boxes[measureIndex]
    const xDistance = orphanHorizontalDistance(xNorm, measureBox, {
      isFirstInSystem: measureIndex === 0,
      isLastInSystem: measureIndex === boxes.length - 1,
    })
    if (xDistance < measureDistance) {
      measureDistance = xDistance
      measureCandidate = {
        measureBox,
        systemIndex: best.systemIndex,
        measureIndex,
        staffClefs: best.staffClefs,
      }
    }
  }

  if (!measureCandidate) {
    return { reason: ORPHAN_REJECTION.NO_MEASURE }
  }
  if (measureDistance > ORPHAN_INTER_SYSTEM_X_PAD) {
    return { reason: ORPHAN_REJECTION.FAR_FROM_MEASURE_X }
  }

  const pitchMapping = resolvePitchFromGrandStaff(
    yNorm,
    measureCandidate.measureBox.staffLines,
    measureCandidate.staffClefs,
  )
  if (pitchMapping.midi == null) {
    return { reason: ORPHAN_REJECTION.PITCH_NULL }
  }

  return {
    measureNumber: measureCandidate.measureBox.measureNumber,
    measureBox: measureCandidate.measureBox,
    staffClefs: measureCandidate.staffClefs,
    systemIndex: measureCandidate.systemIndex,
    measureIndex: measureCandidate.measureIndex,
    pitchMapping,
  }
}

/**
 * Assign orphan SMuFL noteheads to the nearest safe staff/measure.
 */
export function assignVectorOrphanNoteheads({
  glyphs = [],
  imageData,
  systemMeasureBoxes = [],
  staffClefsBySystem = new Map(),
  assignedKeys = null,
}) {
  const assigned = assignedKeys ?? collectAssignedNoteheadGlyphKeys(glyphs, systemMeasureBoxes, imageData)
  const assignments = new Map()
  const diagnostics = {
    orphanNoteheadCount: 0,
    reassignedOrphanCount: 0,
    rejectedOrphanReasons: {},
  }

  function reject(reason) {
    diagnostics.rejectedOrphanReasons[reason] =
      (diagnostics.rejectedOrphanReasons[reason] ?? 0) + 1
  }

  for (const glyph of glyphs) {
    if (!VECTOR_NOTEHEAD_GLYPHS.has(glyph.text)) {
      continue
    }
    const key = noteheadGlyphKey(glyph)
    if (assigned.has(key)) {
      continue
    }
    diagnostics.orphanNoteheadCount += 1

    const xNorm = glyph.x / imageData.width
    const yNorm = glyph.y / imageData.height
    const candidate = resolveOrphanMeasureCandidate({
      xNorm,
      yNorm,
      systemMeasureBoxes,
      staffClefsBySystem,
    })
    if (candidate.reason) {
      reject(candidate.reason)
      continue
    }

    const measureNumber = candidate.measureNumber
    const bucket = assignments.get(measureNumber) ?? []
    bucket.push({
      glyph,
      measureBox: candidate.measureBox,
      staffClefs: candidate.staffClefs,
      systemIndex: candidate.systemIndex,
      measureIndex: candidate.measureIndex,
    })
    assignments.set(measureNumber, bucket)
    assigned.add(key)
    diagnostics.reassignedOrphanCount += 1
  }

  return { assignments, diagnostics, assignedKeys: assigned }
}

export function summarizeOrphanDiagnostics(diagnosticsList = []) {
  return diagnosticsList.reduce(
    (acc, entry) => {
      acc.orphanNoteheadCount += entry?.orphanNoteheadCount ?? 0
      acc.reassignedOrphanCount += entry?.reassignedOrphanCount ?? 0
      for (const [reason, count] of Object.entries(entry?.rejectedOrphanReasons ?? {})) {
        acc.rejectedOrphanReasons[reason] = (acc.rejectedOrphanReasons[reason] ?? 0) + count
      }
      return acc
    },
    { orphanNoteheadCount: 0, reassignedOrphanCount: 0, rejectedOrphanReasons: {} },
  )
}
