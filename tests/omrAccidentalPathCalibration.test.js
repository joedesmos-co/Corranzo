import { describe, expect, it } from 'vitest'
import {
  accidentalPathCalibrationKey,
  accidentalPathHorizontalResidual,
  buildAccidentalPathCalibrations,
  createAccidentalPathCalibrationSample,
  lookupAccidentalPathCalibration,
} from '../src/features/omr/accidentalPathCalibration.js'
import { buildPageAccidentalPathCalibration } from '../src/features/omr/processVectorOmrPage.js'

function calibrationSample(dxSpaces, index, overrides = {}) {
  const measureId = overrides.measureId ?? (index < 8 ? 1 : 2)
  return {
    key: overrides.key ?? accidentalPathCalibrationKey('sharp'),
    type: overrides.type ?? 'sharp',
    source: overrides.source ?? 'vector-path',
    confidence: overrides.confidence ?? 0.92,
    noteAnchorSource:
      overrides.noteAnchorSource ?? 'self-calibrated-glyph-fallback',
    noteAnchorConfidence: overrides.noteAnchorConfidence ?? 0.9,
    pathId: overrides.pathId ?? `pdf-acc-p1-op${index}`,
    noteColumnId: overrides.noteColumnId ?? `${measureId}:column-${index}`,
    measureId,
    dxSpaces,
    verticalResidualSpaces: overrides.verticalResidualSpaces ?? 0.04,
  }
}

function directPathObservation({ scale = 1, index = 0, dxSpaces = 2.1 } = {}) {
  const staffGap = 10 * scale
  const noteX = (20 + index * 3) * scale
  const noteY = (30 + (index % 3) * 0.5) * scale
  const imageHeight = 100 * scale
  const glyphX = noteX - dxSpaces * staffGap
  return {
    type: 'sharp',
    staffGap,
    imageData: { height: imageHeight },
    measureId: index < 4 ? 1 : 2,
    glyph: {
      source: 'vector-path',
      confidence: 0.92,
      pathCandidateId: `pdf-acc-p1-op${index}`,
      x: glyphX,
      y: noteY + 0.05 * staffGap,
      bounds: {
        x0: glyphX - 0.3 * staffGap,
        x1: glyphX + 0.3 * staffGap,
        y0: noteY - staffGap,
        y1: noteY + staffGap,
      },
    },
    note: {
      cx: noteX,
      cy: noteY,
      yNorm: noteY / imageHeight,
      measureNumber: index < 4 ? 1 : 2,
      noteheadAnchor: {
        source: 'ink-notehead-geometry',
        confidence: 0.96,
      },
    },
  }
}

describe('page-local vector-path accidental horizontal-offset calibration', () => {
  it('learns a dominant page/type offset while trimming isolated outliers', () => {
    const stable = [
      2.12,
      2.13,
      2.14,
      2.14,
      2.15,
      2.13,
      2.14,
      2.15,
      2.14,
      2.13,
      2.15,
      2.14,
      2.12,
      2.15,
      2.14,
      2.13,
    ].map((dx, index) => calibrationSample(dx, index))
    const outliers = [0.9, 1.35, 2.9].map((dx, offset) =>
      calibrationSample(dx, 20 + offset, {
        measureId: offset === 0 ? 1 : 2,
      }),
    )

    const result = buildAccidentalPathCalibrations([...stable, ...outliers])
    const model = result.models.get(accidentalPathCalibrationKey('sharp'))

    expect(model).toBeTruthy()
    expect(model.sampleCount).toBe(19)
    expect(model.inlierCount).toBe(16)
    expect(model.distinctPathCount).toBe(19)
    expect(model.distinctInlierColumnCount).toBe(16)
    expect(model.measureCount).toBe(2)
    expect(model.preferredDxSpaces).toBeCloseTo(2.14, 2)
    expect(model.inlierFraction).toBeGreaterThan(0.8)
  })

  it('requires eight distinct direct paths and eight distinct note columns', () => {
    const sparse = buildAccidentalPathCalibrations(
      Array.from({ length: 7 }, (_, index) => calibrationSample(2.1, index, {
        measureId: index < 4 ? 1 : 2,
      })),
    )
    expect(sparse.models.size).toBe(0)
    expect(sparse.rejected[0].reason).toBe('insufficient-distinct-evidence')

    const duplicated = buildAccidentalPathCalibrations(
      Array.from({ length: 16 }, (_, index) => calibrationSample(2.1, index, {
        pathId: `pdf-acc-p1-op${index % 4}`,
        noteColumnId: `${index < 8 ? 1 : 2}:column-${index % 4}`,
        measureId: index < 8 ? 1 : 2,
      })),
    )
    expect(duplicated.models.size).toBe(0)
    expect(duplicated.rejected[0].reason).toBe('insufficient-distinct-evidence')
  })

  it('requires consistent evidence from at least two measures', () => {
    const result = buildAccidentalPathCalibrations(
      Array.from({ length: 10 }, (_, index) =>
        calibrationSample(2.1 + (index % 2) * 0.01, index, { measureId: 7 }),
      ),
    )
    expect(result.models.size).toBe(0)
    expect(result.rejected[0].reason).toBe('insufficient-measure-support')
  })

  it('rejects competing horizontal modes instead of choosing one arbitrarily', () => {
    const firstMode = Array.from({ length: 8 }, (_, index) =>
      calibrationSample(1.1 + (index % 2) * 0.01, index, {
        measureId: index < 4 ? 1 : 2,
      }),
    )
    const secondMode = Array.from({ length: 8 }, (_, index) =>
      calibrationSample(2.1 + (index % 2) * 0.01, index + 20, {
        measureId: index < 4 ? 1 : 2,
      }),
    )
    const result = buildAccidentalPathCalibrations([...firstMode, ...secondMode])
    expect(result.models.size).toBe(0)
    expect(result.rejected[0].reason).toBe('competing-horizontal-modes')
  })

  it('rejects a mode that does not survive leave-one-measure-out validation', () => {
    const samples = [
      ...Array.from({ length: 8 }, (_, index) =>
        calibrationSample(2.06, index, { measureId: 1 }),
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        calibrationSample(2.19, index + 20, { measureId: 2 }),
      ),
    ]
    const result = buildAccidentalPathCalibrations(samples)
    expect(result.models.size).toBe(0)
    expect(result.rejected[0].reason).toBe('leave-one-measure-out-instability')
  })

  it('rejects a broad mode by both robust spread safeguards', () => {
    const highMad = buildAccidentalPathCalibrations(
      Array.from({ length: 16 }, (_, index) =>
        calibrationSample(index % 2 ? 2.17 : 2, index, {
          measureId: index < 8 ? 1 : 2,
        }),
      ),
    )
    expect(highMad.models.size).toBe(0)
    expect(highMad.rejected[0]).toMatchObject({
      reason: 'excessive-inlier-dispersion',
      spanSpaces: 0.17,
    })
    expect(highMad.rejected[0].madSpaces).toBeGreaterThan(0.075)

    const excessiveSpan = buildAccidentalPathCalibrations([
      ...Array.from({ length: 8 }, (_, index) =>
        calibrationSample(2.1, index, { measureId: index < 4 ? 1 : 2 }),
      ),
      calibrationSample(1.94, 20, { measureId: 1 }),
      calibrationSample(2.26, 21, { measureId: 2 }),
    ])
    expect(excessiveSpan.models.size).toBe(0)
    expect(excessiveSpan.rejected[0]).toMatchObject({
      reason: 'excessive-inlier-dispersion',
      spanSpaces: 0.32,
    })
  })

  it('creates samples only from high-confidence direct paths with strict geometry', () => {
    const observation = directPathObservation()
    expect(createAccidentalPathCalibrationSample(observation)).toMatchObject({
      type: 'sharp',
      source: 'vector-path',
      pathId: 'pdf-acc-p1-op0',
      measureId: '1',
      dxSpaces: 2.1,
      verticalResidualSpaces: 0.05,
    })

    expect(createAccidentalPathCalibrationSample({
      ...observation,
      glyph: { ...observation.glyph, source: 'vector-ink' },
    })).toBeNull()
    expect(createAccidentalPathCalibrationSample({
      ...observation,
      glyph: {
        ...observation.glyph,
        pathCandidateId: 'pdf-acc-p1-cluster-0',
        reason: 'path-cluster-sharp',
      },
    })).toBeNull()
    expect(createAccidentalPathCalibrationSample({
      ...observation,
      glyph: { ...observation.glyph, confidence: 0.7 },
    })).toBeNull()
    expect(createAccidentalPathCalibrationSample({
      ...observation,
      glyph: {
        ...observation.glyph,
        bounds: { ...observation.glyph.bounds, x1: observation.note.cx },
      },
    })).toBeNull()
    expect(createAccidentalPathCalibrationSample({
      ...observation,
      glyph: { ...observation.glyph, y: observation.note.cy + 3 },
    })).toBeNull()
  })

  it('normalizes observations by staff gap across uniform page scaling', () => {
    const atOneX = Array.from({ length: 8 }, (_, index) =>
      createAccidentalPathCalibrationSample(directPathObservation({ scale: 1, index })),
    )
    const atTwoX = Array.from({ length: 8 }, (_, index) =>
      createAccidentalPathCalibrationSample(directPathObservation({ scale: 2, index })),
    )
    const oneXModel = buildAccidentalPathCalibrations(atOneX).models.get(
      accidentalPathCalibrationKey('sharp'),
    )
    const twoXModel = buildAccidentalPathCalibrations(atTwoX).models.get(
      accidentalPathCalibrationKey('sharp'),
    )

    expect(oneXModel.preferredDxSpaces).toBeCloseTo(2.1, 8)
    expect(twoXModel.preferredDxSpaces).toBeCloseTo(2.1, 8)
    expect(twoXModel.preferredDxSpaces).toBeCloseTo(oneXModel.preferredDxSpaces, 8)
  })

  it('keeps accidental types isolated and leaves unknown types conservative', () => {
    const sharpSamples = Array.from({ length: 8 }, (_, index) =>
      calibrationSample(2.1, index, { measureId: index < 4 ? 1 : 2 }),
    )
    const flatSamples = Array.from({ length: 8 }, (_, index) =>
      calibrationSample(1.55, index + 20, {
        key: accidentalPathCalibrationKey('flat'),
        type: 'flat',
        measureId: index < 4 ? 1 : 2,
      }),
    )
    const calibration = buildAccidentalPathCalibrations([
      ...sharpSamples,
      ...flatSamples,
    ])

    expect(lookupAccidentalPathCalibration(calibration, 'sharp').preferredDxSpaces)
      .toBeCloseTo(2.1)
    expect(lookupAccidentalPathCalibration(calibration, 'flat').preferredDxSpaces)
      .toBeCloseTo(1.55)
    expect(lookupAccidentalPathCalibration(calibration, 'natural')).toBeNull()
    expect(accidentalPathCalibrationKey('unknown')).toBeNull()
  })

  it('reports preferred-offset residual without changing uncalibrated behavior', () => {
    const calibration = buildAccidentalPathCalibrations(
      Array.from({ length: 8 }, (_, index) =>
        calibrationSample(2.1, index, { measureId: index < 4 ? 1 : 2 }),
      ),
    )
    expect(accidentalPathHorizontalResidual({
      noteX: 100,
      glyphX: 79,
      staffGap: 10,
      type: 'sharp',
      calibration,
    })).toMatchObject({
      dxSpaces: 2.1,
      preferredDxSpaces: 2.1,
      residualSpaces: 0,
      residualPixels: 0,
    })
    expect(accidentalPathHorizontalResidual({
      noteX: 100,
      glyphX: 79,
      staffGap: 10,
      type: 'natural',
      calibration,
    })).toBeNull()
  })

  it('collects a stable page model across held-out measures from trusted anchors', () => {
    const imageData = { width: 1000, height: 1000 }
    const staffLines = {
      treble: [0.1, 0.12, 0.14, 0.16, 0.18],
      bass: [],
    }
    const boxes = [
      { measureNumber: 1, x0: 0.1, playableX0: 0.12, x1: 0.44, y0: 0.05, y1: 0.22, staffLines },
      { measureNumber: 2, x0: 0.44, playableX0: 0.46, x1: 0.82, y0: 0.05, y1: 0.22, staffLines },
    ]
    const paths = []
    const records = boxes.map((box, measureIndex) => {
      const notes = []
      for (let index = 0; index < 4; index += 1) {
        const pathX = 140 + measureIndex * 360 + index * 58
        const y = 120 + index * 10
        paths.push({
          source: 'vector-path',
          candidateId: `pdf-acc-p1-op${measureIndex * 4 + index}`,
          confidence: 0.92,
          type: 'sharp',
          x: pathX,
          y,
          bounds: { x0: pathX - 5, x1: pathX + 5, y0: y - 12, y1: y + 12 },
        })
        notes.push({
          cx: pathX + 42,
          cy: y + 8,
          yNorm: y / imageData.height,
          clef: 'treble',
          measureNumber: box.measureNumber,
          noteheadAnchor: {
            source: 'ink-notehead-geometry',
            confidence: 0.96,
          },
        })
      }
      return {
        measureNumber: box.measureNumber,
        detectorObservations: { noteheads: notes },
      }
    })
    const calibration = buildPageAccidentalPathCalibration({
      vectorAccidentalPaths: paths,
      imageData,
      measureRecordsBySystem: [records],
      measureBoxByNumber: new Map(boxes.map((box) => [box.measureNumber, box])),
      placementByMeasure: new Map(boxes.map((box) => [box.measureNumber, {}])),
    })

    expect(calibration.accepted).toHaveLength(1)
    expect(calibration.accepted[0].preferredDxSpaces).toBeCloseTo(2.1, 6)
    expect(calibration.accepted[0].measureCount).toBe(2)
    expect(calibration.diagnostics.directCandidateCount).toBe(8)
  })

  it('does not learn a page offset from untrusted glyph-metric fallback anchors', () => {
    const imageData = { width: 1000, height: 1000 }
    const staffLines = { treble: [0.1, 0.12, 0.14, 0.16, 0.18], bass: [] }
    const boxes = [1, 2].map((measureNumber, index) => ({
      measureNumber,
      x0: 0.1 + index * 0.35,
      playableX0: 0.12 + index * 0.35,
      x1: 0.45 + index * 0.35,
      y0: 0.05,
      y1: 0.22,
      staffLines,
    }))
    const paths = Array.from({ length: 8 }, (_, index) => ({
      source: 'vector-path',
      candidateId: `pdf-acc-p1-op${index}`,
      confidence: 0.92,
      type: 'sharp',
      x: 140 + (index >= 4 ? 350 : 0) + (index % 4) * 58,
      y: 130,
      bounds: {
        x0: 135 + (index >= 4 ? 350 : 0) + (index % 4) * 58,
        x1: 145 + (index >= 4 ? 350 : 0) + (index % 4) * 58,
        y0: 118,
        y1: 142,
      },
    }))
    const records = boxes.map((box, measureIndex) => ({
      measureNumber: box.measureNumber,
      detectorObservations: {
        noteheads: paths.slice(measureIndex * 4, measureIndex * 4 + 4).map((path) => ({
          cx: path.x + 42,
          cy: path.y,
          yNorm: path.y / imageData.height,
          clef: 'treble',
          measureNumber: box.measureNumber,
          noteheadAnchor: {
            source: 'glyph-metrics-fallback',
            confidence: 0.7,
          },
        })),
      },
    }))
    const calibration = buildPageAccidentalPathCalibration({
      vectorAccidentalPaths: paths,
      imageData,
      measureRecordsBySystem: [records],
      measureBoxByNumber: new Map(boxes.map((box) => [box.measureNumber, box])),
      placementByMeasure: new Map(boxes.map((box) => [box.measureNumber, {}])),
    })

    expect(calibration.models.size).toBe(0)
    expect(calibration.diagnostics.rawSampleCount).toBe(0)
  })
})
