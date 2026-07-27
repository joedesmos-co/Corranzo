/**
 * Beam/duration classification for rhythm recognition.
 *
 * Saturated tip-row beamStrength must not be read as sixteenths.
 */
import { describe, expect, it } from 'vitest'
import {
  countBeams,
  countFlags,
  enrichNoteheadRhythm,
  inferNoteDuration,
  measureBeamStrength,
} from '../src/features/omr/detectNoteRhythmFeatures.js'

function makeImage(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4)
  data.fill(255)
  const setInk = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = (y * width + x) * 4
    data[i] = 0
    data[i + 1] = 0
    data[i + 2] = 0
    data[i + 3] = 255
  }
  paint(setInk)
  return { width, height, data }
}

describe('inferNoteDuration beam classification', () => {
  it('treats saturated beamStrength as eighth, not sixteenth', () => {
    const stem = { x: 40, tipY: 20, length: 18, direction: 'up' }
    expect(
      inferNoteDuration({
        hollow: false,
        stem,
        beams: 0,
        dotted: false,
        beamStrength: 29,
      }).durationType,
    ).toBe('eighth')
    expect(
      inferNoteDuration({
        hollow: false,
        stem,
        beams: 1,
        dotted: false,
        beamStrength: 29,
      }).durationType,
    ).toBe('eighth')
  })

  it('requires beams>=2 for sixteenth (not tip-row strength)', () => {
    const stem = { x: 40, tipY: 20, length: 18, direction: 'up' }
    expect(
      inferNoteDuration({
        hollow: false,
        stem,
        beams: 2,
        dotted: false,
        beamStrength: 10,
      }).durationType,
    ).toBe('sixteenth')
  })
})

describe('countBeams saturated primary beams', () => {
  it('accepts continuous tip-row ink beyond the old strength>22 reject', () => {
    const image = makeImage(80, 60, (ink) => {
      // Stem tip at y=10, continuous beam to the right for 28px.
      for (let x = 30; x <= 58; x += 1) {
        ink(x, 10)
      }
    })
    const stem = { x: 30, tipY: 10, length: 20, direction: 'up' }
    expect(measureBeamStrength(image, stem, 200)).toBeGreaterThan(22)
    expect(countBeams(image, stem, 200, { left: 0, right: 79, top: 0, bottom: 59 })).toBe(1)
  })

  it('counts a secondary beam row toward the notehead as beams=2', () => {
    const image = makeImage(80, 60, (ink) => {
      // Primary beam at tip y=10
      for (let x = 30; x <= 55; x += 1) {
        ink(x, 10)
      }
      // Secondary beam toward notehead (stem-up → +y)
      for (let x = 30; x <= 52; x += 1) {
        ink(x, 14)
      }
    })
    const stem = { x: 30, tipY: 10, length: 20, direction: 'up' }
    expect(countBeams(image, stem, 200, { left: 0, right: 79, top: 0, bottom: 59 })).toBe(2)
  })

  it('counts a double flag as beams=2 when no primary beam exists', () => {
    const image = makeImage(80, 60, (ink) => {
      // Stem tip flags to the right (stem-up): two short runs, not a beam.
      for (let x = 31; x <= 36; x += 1) {
        ink(x, 10)
      }
      for (let x = 31; x <= 35; x += 1) {
        ink(x, 14)
      }
    })
    const stem = { x: 30, tipY: 10, length: 20, direction: 'up' }
    expect(measureBeamStrength(image, stem, 200)).toBeLessThan(8)
    expect(countBeams(image, stem, 200, { left: 0, right: 79, top: 0, bottom: 59 })).toBe(0)
    expect(countFlags(image, stem, 200)).toBe(2)
  })

  it('does not treat notehead-adjacent noise as flags without a tip short run', () => {
    const image = makeImage(80, 60, (ink) => {
      // Noise left of stem only (wrong side for up-stem flags).
      for (let x = 20; x <= 28; x += 1) {
        ink(x, 10)
      }
    })
    const stem = { x: 30, tipY: 10, length: 20, direction: 'up' }
    expect(countBeams(image, stem, 200, { left: 0, right: 79, top: 0, bottom: 59 })).toBe(0)
  })
})

describe('enrichNoteheadRhythm persists beamStrength', () => {
  it('returns beamStrength on the enriched note', () => {
    const image = makeImage(80, 80, (ink) => {
      // Filled head around (20,40)
      for (let y = 38; y <= 42; y += 1) {
        for (let x = 17; x <= 23; x += 1) {
          ink(x, y)
        }
      }
      // Stem up at x=24
      for (let y = 20; y <= 38; y += 1) {
        ink(24, y)
      }
      // Beam at tip
      for (let x = 24; x <= 50; x += 1) {
        ink(x, 20)
      }
    })
    const enriched = enrichNoteheadRhythm(
      image,
      { cx: 20, cy: 40 },
      { y0: 0.2, y1: 0.8 },
      200,
      { left: 0, right: 79, top: 0, bottom: 79 },
    )
    expect(enriched.beamStrength).toBeGreaterThanOrEqual(8)
    expect(enriched.beams).toBe(1)
    expect(enriched.durationType).toBe('eighth')
  })
})
