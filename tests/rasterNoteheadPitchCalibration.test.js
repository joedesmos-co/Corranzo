import { describe, expect, it } from 'vitest'
import { buildRasterNoteheadPitchCalibration } from '../src/features/omr/rasterNoteheadPitchCalibration.js'

const HEIGHT = 1000
const LINES = [0.2, 0.214, 0.228, 0.242, 0.256]

function noteAtPhase(phase, index = 0, overrides = {}) {
  const gapPx = ((LINES[4] - LINES[0]) * HEIGHT) / 4
  const bottomPx = LINES[4] * HEIGHT
  return {
    cy: bottomPx + (index + phase) * (gapPx / 2),
    pitchMapping: { lineYs: LINES },
    detectionEvidence: {
      wideRows: 9,
      midFill: 0.42,
      verticalRun: 8,
      ...overrides,
    },
  }
}

describe('raster notehead pitch calibration', () => {
  it('recovers a repeated staff-relative optical-center phase', () => {
    const notes = Array.from({ length: 24 }, (_, index) =>
      noteAtPhase(0.44 + ((index % 3) - 1) * 0.015, index % 7),
    )
    const calibration = buildRasterNoteheadPitchCalibration(notes, HEIGHT)
    expect(calibration.applied).toBe(true)
    expect(calibration.offsetRatio).toBeCloseTo(0.22, 1)
    expect(calibration.confidence).toBeGreaterThan(0.7)
  })

  it('does not invent an offset for already centered noteheads', () => {
    const notes = Array.from({ length: 20 }, (_, index) => noteAtPhase(0.01, index % 6))
    const calibration = buildRasterNoteheadPitchCalibration(notes, HEIGHT)
    expect(calibration.applied).toBe(false)
    expect(calibration.reason).toBe('implausible-optical-offset')
  })

  it('rejects sparse and diffuse page evidence', () => {
    expect(
      buildRasterNoteheadPitchCalibration(
        Array.from({ length: 5 }, (_, index) => noteAtPhase(0.44, index)),
        HEIGHT,
      ).applied,
    ).toBe(false)

    const diffuse = Array.from({ length: 24 }, (_, index) => noteAtPhase(index / 24, index % 5))
    expect(buildRasterNoteheadPitchCalibration(diffuse, HEIGHT).applied).toBe(false)
  })
})
