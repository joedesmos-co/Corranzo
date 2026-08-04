/**
 * Beam/duration classification for rhythm recognition.
 *
 * Saturated tip-row beamStrength must not be read as sixteenths.
 */
import { describe, expect, it } from 'vitest'
import {
  countBeams,
  countFlags,
  detectDot,
  detectStem,
  enrichNoteheadRhythm,
  inferNoteDuration,
  isHollowNotehead,
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

describe('raster notehead hollowness', () => {
  it('distinguishes an enclosed open center from an antialiased filled center', () => {
    const hollow = makeImage(40, 40, (ink) => {
      for (let x = 17; x <= 23; x += 1) {
        ink(x, 18)
        ink(x, 22)
      }
      for (let y = 18; y <= 22; y += 1) {
        ink(17, y)
        ink(23, y)
      }
      // A staff line may pass through the center without filling the head.
      for (let x = 19; x <= 21; x += 1) ink(x, 20)
    })
    expect(isHollowNotehead(hollow, 20, 20, 200)).toBe(true)

    const filled = makeImage(40, 40, (ink) => {
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0]]) {
        ink(20 + dx, 20 + dy)
      }
      for (let x = 17; x <= 23; x += 1) ink(x, 18)
      for (let x = 17; x <= 23; x += 1) ink(x, 22)
    })
    expect(isHollowNotehead(filled, 20, 20, 200)).toBe(false)
  })
})

describe('inferNoteDuration beam classification', () => {
  it('uses whole/half notehead glyphs over stem ink', () => {
    expect(
      inferNoteDuration({
        hollow: true,
        stem: { length: 20, direction: 'up' },
        beams: 0,
        dotted: false,
        noteheadGlyph: 'whole',
      }).durationType,
    ).toBe('whole')
    expect(
      inferNoteDuration({
        hollow: true,
        stem: null,
        beams: 0,
        dotted: false,
        noteheadGlyph: 'half',
      }).durationType,
    ).toBe('half')
  })

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

  it('does not reinterpret a filled head as a half note because its stem is long', () => {
    expect(
      inferNoteDuration({
        hollow: false,
        stem: { length: 38, direction: 'up' },
        beams: 0,
        dotted: false,
      }).durationType,
    ).toBe('quarter')
  })
})

describe('detectStem ownership', () => {
  it('finds an up-stem on a bass-register head without using register as direction', () => {
    const image = makeImage(90, 90, (ink) => {
      for (let y = 35; y <= 62; y += 1) ink(48, y)
    })
    const stem = detectStem(image, 42, 62, 200, 40, 12)
    expect(stem).toMatchObject({ direction: 'up', side: 'right', x: 48 })
    expect(stem.length).toBeGreaterThanOrEqual(27)
  })

  it('finds a conventional down-stem on the left side', () => {
    const image = makeImage(90, 90, (ink) => {
      for (let y = 28; y <= 58; y += 1) ink(34, y)
    })
    const stem = detectStem(image, 40, 28, 200, 45, 12)
    expect(stem).toMatchObject({ direction: 'down', side: 'left', x: 34 })
    expect(stem.length).toBeGreaterThanOrEqual(30)
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

  it('does not classify a staff line at the stem tip as a beam', () => {
    const image = makeImage(80, 80, (ink) => {
      for (let y = 38; y <= 42; y += 1) {
        for (let x = 17; x <= 23; x += 1) ink(x, y)
      }
      for (let y = 20; y <= 38; y += 1) ink(24, y)
      for (let x = 0; x < 80; x += 1) ink(x, 20)
    })
    const enriched = enrichNoteheadRhythm(
      image,
      {
        cx: 20,
        cy: 40,
        clef: 'treble',
        pitchMapping: { lineYs: [20, 28, 36, 44, 52].map((y) => y / 80) },
      },
      { y0: 0.2, y1: 0.8 },
      200,
      { left: 0, right: 79, top: 0, bottom: 79 },
    )
    expect(enriched.beamStrength).toBe(0)
    expect(enriched.beams).toBe(0)
    expect(enriched.durationType).toBe('quarter')
  })
})

describe('augmentation-dot isolation', () => {
  it('finds a compact scale-aware dot beyond a right-side stem', () => {
    const image = makeImage(80, 60, (ink) => {
      ink(36, 30)
      ink(37, 30)
      ink(36, 31)
    })
    expect(detectDot(image, 20, 30, 200, 12, { x: 27 })).toBe(true)
  })

  it('rejects a stem or continuous staff row in the dot search band', () => {
    const stemImage = makeImage(80, 60, (ink) => {
      for (let y = 20; y <= 40; y += 1) ink(31, y)
    })
    expect(detectDot(stemImage, 20, 30, 200, 12, { x: 31 })).toBe(false)
    const lineImage = makeImage(80, 60, (ink) => {
      for (let x = 0; x < 80; x += 1) ink(x, 30)
    })
    expect(detectDot(lineImage, 20, 30, 200, 12)).toBe(false)
  })
})
