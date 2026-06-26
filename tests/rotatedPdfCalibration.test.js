import { describe, expect, it, vi } from 'vitest'
import {
  buildCalibrationDebugSnapshotFromPreview,
  buildCalibrationExportReport,
  collectCalibrationWarnings,
} from '../src/features/score-follow/calibrationDebug.js'
import {
  loadCalibrationDebugSnapshot,
  saveCalibrationDebugSnapshot,
} from '../src/features/score-follow/calibrationDebugStorage.js'
import { analyzeSemiAutoScoreSetup } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import {
  getEffectivePageSize,
  getPageViewRotation,
  isViewerRotationCorrected,
  pageViewRotationsFromOrientation,
} from '../src/utils/pdfPageViewRotation.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import * as F from './helpers/buildXml.js'
import { cleanPianoPage, renderPagesFromArray } from './helpers/syntheticScore.js'
import { rotateImageData } from '../src/features/score-follow/pageOrientation.js'

const SETUP_KEY = 'scoreflow-auto-setup-v1-test::timing'

function pianoTimingMap(measureCount, { breakEvery = null } = {}) {
  let xml = ''
  for (let m = 1; m <= measureCount; m += 1) {
    xml += `<measure number="${m}">`
    if (m === 1) xml += F.attributes() + F.soundTempo(120)
    if (breakEvery && m > 1 && (m - 1) % breakEvery === 0) xml += '<print new-system="yes"/>'
    xml += F.fourQuarters()
    xml += `</measure>`
  }
  return parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
}

function makePreview(over = {}) {
  return {
    proposedAnchors: [
      { id: 'a1', page: 1, measureNumber: 1, x: 0.12, y: 0.3, source: 'auto' },
      { id: 'a2', page: 1, measureNumber: 5, x: 0.88, y: 0.3, source: 'auto' },
    ],
    supplementalMeasureAnchors: [],
    debugReport: {
      confidence: 0.62,
      allocationMode: 'barline',
      stage: 'tolerant',
      systems: [{ index: 0, page: 1, y0: 0.2, y1: 0.4, center: 0.3 }],
    },
    smartCalibration: {
      chosenStrategy: 'B',
      overallConfidence: 0.62,
      calibrationMs: 30,
      perPageConfidence: [{ page: 1, confidence: 0.62 }],
      perSystemConfidence: [{ index: 0, confidence: 0.5 }],
    },
    orientation: {
      anyRotated: true,
      anyUncertain: false,
      maxRotation: 90,
      pages: [{ page: 1, rotation: 90, uncertain: false, confidence: 0.9 }],
    },
    plausible: true,
    approximate: true,
    ...over,
  }
}

describe('rotated PDF calibration debug', () => {
  it('rotated page detection produces an exportable calibration report', async () => {
    const sideways = rotateImageData(cleanPianoPage({ systems: 3, measuresPerSystem: 4 }), 90)
    const timingMap = pianoTimingMap(12, { breakEvery: 4 })
    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'synthetic',
      numPages: 1,
      timingMap,
      renderPage: renderPagesFromArray([sideways]),
    })

    expect(result.ok).toBe(true)
    expect(result.preview.orientation.anyRotated).toBe(true)

    const snapshot = buildCalibrationDebugSnapshotFromPreview(result.preview, {
      pageViewRotations: pageViewRotationsFromOrientation(result.preview.orientation),
    })
    const report = buildCalibrationExportReport({ snapshot, pieceName: 'Rotated test' })
    expect(report.orientation?.anyRotated).toBe(true)
    expect(report.overallConfidence).toBeTruthy()
    expect(report.systemBounds.length).toBeGreaterThan(0)
  })

  it('builds a debug snapshot for low-confidence approximate setup', () => {
    const snapshot = buildCalibrationDebugSnapshotFromPreview(makePreview(), {
      pageViewRotations: { 1: 90 },
    })
    expect(snapshot).not.toBeNull()
    expect(snapshot.setupPhase).toBe('approximate')
    expect(snapshot.warnings.some((w) => w.code === 'low-system-confidence')).toBe(true)
  })

  it('shows rotated-page warning when viewer correction is missing', () => {
    const warnings = collectCalibrationWarnings({
      orientation: makePreview().orientation,
      pageViewRotations: {},
    })
    expect(warnings.some((w) => w.code === 'rotation-viewer-mismatch')).toBe(true)
    expect(
      warnings.find((w) => w.code === 'rotation-viewer-mismatch')?.message,
    ).toMatch(/Rotate page/i)
  })

  it('marks viewer correction applied when rotations match detection', () => {
    const orientation = makePreview().orientation
    const rotations = pageViewRotationsFromOrientation(orientation)
    expect(isViewerRotationCorrected(orientation, rotations)).toBe(true)
    const snapshot = buildCalibrationDebugSnapshotFromPreview(makePreview(), {
      pageViewRotations: rotations,
    })
    expect(snapshot.viewerCorrectionApplied).toBe(true)
    expect(snapshot.warnings.some((w) => w.code === 'page-rotated')).toBe(true)
  })

  it('uses swapped page dimensions for quarter-turn viewer rotation', () => {
    const effective = getEffectivePageSize({ width: 800, height: 1200 }, 90)
    expect(effective).toEqual({ width: 1200, height: 800 })
    expect(getEffectivePageSize({ width: 800, height: 1200 }, 0)).toEqual({
      width: 800,
      height: 1200,
    })
  })

  it('persists calibration snapshot across session reload', () => {
    const store = new Map()
    vi.stubGlobal('sessionStorage', {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    })

    const snapshot = buildCalibrationDebugSnapshotFromPreview(makePreview(), {
      pageViewRotations: { 1: 90 },
    })
    saveCalibrationDebugSnapshot(SETUP_KEY, snapshot)
    const restored = loadCalibrationDebugSnapshot(SETUP_KEY)
    expect(restored?.smartCalibration?.overallConfidence).toBe(0.62)
    expect(restored?.pageViewRotations).toEqual({ 1: 90 })

    vi.unstubAllGlobals()
  })

  it('leaves upright PDF orientation unchanged', async () => {
    const page = cleanPianoPage({ systems: 3, measuresPerSystem: 4 })
    const timingMap = pianoTimingMap(12, { breakEvery: 4 })
    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'synthetic',
      numPages: 1,
      timingMap,
      renderPage: renderPagesFromArray([page]),
    })
    expect(result.preview.orientation.anyRotated).toBe(false)
    expect(pageViewRotationsFromOrientation(result.preview.orientation)).toEqual({})
    expect(getPageViewRotation({}, 1)).toBe(0)
  })
})
