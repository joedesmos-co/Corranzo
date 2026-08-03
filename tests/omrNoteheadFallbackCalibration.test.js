import { describe, expect, it } from 'vitest'
import {
  applyNoteheadFallbackCalibration,
  buildNoteheadFallbackCalibrations,
  noteheadFallbackCalibrationKey,
} from '../src/features/omr/noteheadFallbackCalibration.js'

function glyph(overrides = {}) {
  return {
    text: '\ue0a4',
    fontName: 'EmbeddedMusicSubset',
    x: 120,
    y: 160,
    width: 18,
    height: 30,
    ...overrides,
  }
}

function trustedSample(offsetSpaces, overrides = {}) {
  return {
    glyph: glyph(overrides.glyph),
    source: overrides.source ?? 'ink-notehead-geometry',
    confidence: overrides.confidence ?? 0.96,
    originToCenterSpaces: offsetSpaces,
    glyphHeightSpaces: overrides.glyphHeightSpaces ?? 1.5,
  }
}

function metricAnchor(overrides = {}) {
  return {
    yNorm: 0.57,
    fallbackYNorm: 0.57,
    rawYNorm: 0.6,
    source: 'glyph-metrics-fallback',
    confidence: 0.45,
    rejectedReason: 'no-head-sized-component',
    localStaffGapNorm: 0.1,
    ...overrides,
  }
}

describe('self-calibrated notehead fallback', () => {
  it('builds a robust exact-font/glyph model from consistent trusted ink', () => {
    const result = buildNoteheadFallbackCalibrations([
      0.49,
      0.5,
      0.5,
      0.51,
      0.51,
      0.52,
      0.52,
      0.53,
    ].map((offset) => trustedSample(offset)))

    const model = result.models.get(noteheadFallbackCalibrationKey(glyph()))
    expect(model).toBeTruthy()
    expect(model.sampleCount).toBe(8)
    expect(model.inlierCount).toBe(8)
    expect(model.originToCenterSpaces).toBeCloseTo(0.51, 2)
    expect(model.confidence).toBeGreaterThanOrEqual(0.78)
  })

  it('rejects sparse or inconsistent evidence instead of creating a profile', () => {
    const sparse = buildNoteheadFallbackCalibrations(
      [0.49, 0.5, 0.51, 0.52, 0.5].map((offset) => trustedSample(offset)),
    )
    expect(sparse.models.size).toBe(0)
    expect(sparse.rejected[0].reason).toBe('insufficient-samples')

    const inconsistent = buildNoteheadFallbackCalibrations(
      [0.34, 0.4, 0.47, 0.54, 0.61, 0.68, 0.74, 0.8].map((offset) =>
        trustedSample(offset),
      ),
    )
    expect(inconsistent.models.size).toBe(0)
    expect(inconsistent.rejected[0].reason).toMatch(/dispersion|inlier/)
  })

  it('uses robust inliers while rejecting isolated wrong-body anchors', () => {
    const result = buildNoteheadFallbackCalibrations([
      ...[0.49, 0.5, 0.5, 0.51, 0.51, 0.52, 0.52, 0.53].map((offset) =>
        trustedSample(offset),
      ),
      trustedSample(0.98),
    ])
    const model = result.models.get(noteheadFallbackCalibrationKey(glyph()))
    expect(model).toBeTruthy()
    expect(model.sampleCount).toBe(9)
    expect(model.inlierCount).toBe(8)
    expect(model.originToCenterSpaces).toBeCloseTo(0.51, 2)
  })

  it('keeps font, glyph class, and legacy identity isolated', () => {
    const samples = [0.49, 0.5, 0.5, 0.51, 0.51, 0.52].map((offset) =>
      trustedSample(offset),
    )
    const result = buildNoteheadFallbackCalibrations(samples)
    expect(
      result.models.has(
        noteheadFallbackCalibrationKey(glyph({ fontName: 'OtherFont' })),
      ),
    ).toBe(false)
    expect(
      result.models.has(noteheadFallbackCalibrationKey(glyph({ text: '\ue0a3' }))),
    ).toBe(false)
    expect(
      noteheadFallbackCalibrationKey(
        glyph({ legacyMusicFontNormalized: true }),
      ),
    ).toBeNull()
  })

  it('applies the staff-space calibration across uniform page scaling', () => {
    const result = buildNoteheadFallbackCalibrations(
      [0.49, 0.5, 0.5, 0.51, 0.51, 0.52].map((offset) =>
        trustedSample(offset),
      ),
    )
    const targetGlyph = glyph({ y: 336, width: 36, height: 84 })
    const calibrated = applyNoteheadFallbackCalibration({
      anchor: metricAnchor({
        yNorm: 0.57,
        fallbackYNorm: 0.57,
        rawYNorm: 0.6,
        localStaffGapNorm: 0.1,
      }),
      glyph: targetGlyph,
      imageData: { width: 480, height: 560 },
      lineYs: [0.4, 0.5, 0.6, 0.7, 0.8],
      calibration: result,
    })

    expect(calibrated.source).toBe('self-calibrated-glyph-fallback')
    expect(calibrated.yNorm).toBeCloseTo(0.549, 3)
    expect(calibrated.inkRejectedReason).toBe('no-head-sized-component')
    expect(calibrated.calibration.sampleCount).toBe(6)
  })

  it('leaves unknown fonts and unsafe rejection classes conservative', () => {
    const result = buildNoteheadFallbackCalibrations(
      [0.49, 0.5, 0.5, 0.51, 0.51, 0.52].map((offset) =>
        trustedSample(offset),
      ),
    )
    const baseline = metricAnchor()
    expect(
      applyNoteheadFallbackCalibration({
        anchor: baseline,
        glyph: glyph({ fontName: 'UnknownFont' }),
        imageData: { width: 240, height: 280 },
        lineYs: [0.4, 0.5, 0.6, 0.7, 0.8],
        calibration: result,
      }),
    ).toBe(baseline)
    expect(
      applyNoteheadFallbackCalibration({
        anchor: metricAnchor({ rejectedReason: 'ambiguous-components' }),
        glyph: glyph(),
        imageData: { width: 240, height: 280 },
        lineYs: [0.4, 0.5, 0.6, 0.7, 0.8],
        calibration: result,
      }).source,
    ).toBe('glyph-metrics-fallback')
  })

  it('does not learn from low-confidence, fallback, or legacy observations', () => {
    const result = buildNoteheadFallbackCalibrations([
      ...[0.49, 0.5, 0.51, 0.52].map((offset) => trustedSample(offset)),
      trustedSample(0.5, { confidence: 0.84 }),
      trustedSample(0.5, { source: 'glyph-metrics-fallback' }),
      trustedSample(0.5, { glyph: { legacyMusicFontNormalized: true } }),
    ])
    expect(result.models.size).toBe(0)
    expect(result.eligibleSampleCount).toBe(4)
  })
})
