import { describe, expect, it } from 'vitest'
import {
  computeDocumentStaffGapReference,
  gapsFromStaffLines,
  normalizePageStaffLineGaps,
  respaceStaffLinesFromStaveTop,
  STAFF_GAP_DEVIATION_THRESHOLD,
} from '../src/features/omr/normalizeStaffLineGaps.js'
import { staffLineGap } from '../src/features/omr/pitchFromStaffPosition.js'

const REFERENCE_GAP = 0.00601

function makeStaffLines(upperGap, lowerGap, upperTop = 0.25, lowerTop = 0.31) {
  const treble = [0, 1, 2, 3, 4].map((index) => upperTop + index * upperGap)
  const bass = [0, 1, 2, 3, 4].map((index) => lowerTop + index * lowerGap)
  return {
    treble,
    bass,
    splitY: (treble[4] + bass[0]) / 2,
  }
}

function makeSystem(upperTop, lowerTop, upperGap, lowerGap) {
  return {
    y0: upperTop,
    y1: lowerTop + lowerGap * 4,
    staves: [
      { y0: upperTop, y1: upperTop + upperGap * 4 },
      { y0: lowerTop, y1: lowerTop + lowerGap * 4 },
    ],
  }
}

function makeMeasureBoxes(system, staffLines, page = 8, systemIndex = 0) {
  return [
    {
      page,
      systemIndex,
      measureNumber: 119,
      staffLines,
      x0: 0.1,
      x1: 0.4,
      y0: system.y0,
      y1: system.y1,
    },
  ]
}

describe('respaceStaffLinesFromStaveTop', () => {
  it('places five evenly spaced lines from the stave top', () => {
    const lines = respaceStaffLinesFromStaveTop(0.25, 0.00601)
    expect(lines).toHaveLength(5)
    expect(lines[0]).toBeCloseTo(0.25, 5)
    expect(staffLineGap(lines)).toBeCloseTo(0.00601, 5)
  })
})

describe('computeDocumentStaffGapReference', () => {
  it('returns separate treble and bass medians', () => {
    const reference = computeDocumentStaffGapReference({
      treble: [0.006, 0.00601, 0.00602],
      bass: [0.006, 0.00601, 0.00602],
    })
    expect(reference.combined).toBeCloseTo(0.00601, 4)
    expect(reference.treble).toBeCloseTo(0.00601, 4)
    expect(reference.bass).toBeCloseTo(0.00601, 4)
  })
})

describe('normalizePageStaffLineGaps', () => {
  it('does not normalize when reference sample count is insufficient', () => {
    const inflatedGap = REFERENCE_GAP * 1.38
    const staffLines = makeStaffLines(inflatedGap, inflatedGap)
    const system = makeSystem(0.25, 0.31, inflatedGap, inflatedGap)
    const systemMeasureBoxes = [makeMeasureBoxes(system, staffLines)]

    const result = normalizePageStaffLineGaps({
      systemMeasureBoxes,
      systems: [system],
      page: 8,
      documentGapReference: computeDocumentStaffGapReference({
        treble: [REFERENCE_GAP],
        bass: [REFERENCE_GAP],
      }),
    })

    expect(result.staffGapNormalization.applied).toBe(false)
    expect(staffLineGap(systemMeasureBoxes[0][0].staffLines.bass)).toBeCloseTo(inflatedGap, 5)
  })

  it('normalizes outlier bass gap on final-page-like system', () => {
    const inflatedGap = REFERENCE_GAP * 1.38
    const staffLines = makeStaffLines(REFERENCE_GAP, inflatedGap, 0.0749, 0.1279)
    const system = makeSystem(0.0749, 0.1279, REFERENCE_GAP, inflatedGap)
    const systemMeasureBoxes = [makeMeasureBoxes(system, staffLines)]

    const reference = computeDocumentStaffGapReference({
      treble: Array.from({ length: 6 }, () => REFERENCE_GAP),
      bass: Array.from({ length: 6 }, () => REFERENCE_GAP),
    })

    const result = normalizePageStaffLineGaps({
      systemMeasureBoxes,
      systems: [system],
      page: 8,
      documentGapReference: reference,
    })

    expect(result.staffGapNormalization.applied).toBe(true)
    expect(result.staffGapNormalization.systemsAffected).toHaveLength(1)
    const affected = result.staffGapNormalization.systemsAffected[0]
    expect(affected.originalGaps.bass).toBeCloseTo(inflatedGap, 4)
    expect(affected.normalizedGaps.bass).toBeCloseTo(REFERENCE_GAP, 4)
    expect(staffLineGap(systemMeasureBoxes[0][0].staffLines.bass)).toBeCloseTo(REFERENCE_GAP, 5)
    expect(gapsFromStaffLines(systemMeasureBoxes[0][0].staffLines).treble).toBeCloseTo(REFERENCE_GAP, 5)
  })

  it('leaves in-tolerance systems unchanged', () => {
    const staffLines = makeStaffLines(REFERENCE_GAP, REFERENCE_GAP)
    const system = makeSystem(0.13, 0.2, REFERENCE_GAP, REFERENCE_GAP)
    const systemMeasureBoxes = [makeMeasureBoxes(system, staffLines, 1, 0)]

    const reference = computeDocumentStaffGapReference({
      treble: Array.from({ length: 4 }, () => REFERENCE_GAP),
      bass: Array.from({ length: 4 }, () => REFERENCE_GAP),
    })

    const result = normalizePageStaffLineGaps({
      systemMeasureBoxes,
      systems: [system],
      page: 1,
      documentGapReference: reference,
    })

    expect(result.staffGapNormalization.applied).toBe(false)
    expect(staffLineGap(systemMeasureBoxes[0][0].staffLines.treble)).toBeCloseTo(REFERENCE_GAP, 5)
  })

  it('only normalizes staff roles beyond the deviation threshold', () => {
    const inflatedUpper = REFERENCE_GAP * 1.38
    const staffLines = makeStaffLines(inflatedUpper, REFERENCE_GAP, 0.25, 0.31)
    const system = makeSystem(0.25, 0.31, inflatedUpper, REFERENCE_GAP)
    const systemMeasureBoxes = [makeMeasureBoxes(system, staffLines)]

    const reference = computeDocumentStaffGapReference({
      treble: Array.from({ length: 6 }, () => REFERENCE_GAP),
      bass: Array.from({ length: 6 }, () => REFERENCE_GAP),
    })

    const result = normalizePageStaffLineGaps({
      systemMeasureBoxes,
      systems: [system],
      page: 8,
      documentGapReference: reference,
      deviationThreshold: STAFF_GAP_DEVIATION_THRESHOLD,
    })

    expect(result.staffGapNormalization.applied).toBe(true)
    expect(staffLineGap(systemMeasureBoxes[0][0].staffLines.treble)).toBeCloseTo(REFERENCE_GAP, 5)
    expect(staffLineGap(systemMeasureBoxes[0][0].staffLines.bass)).toBeCloseTo(REFERENCE_GAP, 5)
  })
})
