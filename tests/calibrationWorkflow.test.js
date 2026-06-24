import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { analyzeSemiAutoScoreSetup } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import {
  assessSourceAlignment,
  analyzeSystemMeasureCounts,
  assessCalibrationReadiness,
  buildCalibrationDiagnostics,
  calibrateAnchorsHybrid,
  detectMidiDerivedMusicXml,
  formatCalibrationDiagnosticsText,
} from '../src/features/score-follow/calibrationWorkflow.js'
import {
  manualSystemsFromBundledPayload,
  buildBundledAnchorsFromManualSystems,
  PROMOTION_STATUS,
} from '../src/features/score-follow/demoAnchorCalibration.js'
import { cleanPianoPage, densePianoPage, renderPagesFromArray } from './helpers/syntheticScore.js'
import { METADATA_FIXTURES } from './fixtures/alignmentFixtures.js'
import * as F from './helpers/buildXml.js'

const minuetReference = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../public/fixtures/demo-minuet-in-g.anchors.json', import.meta.url)),
    'utf8',
  ),
)

function pianoTimingMap(measureCount, { breakEvery = null } = {}) {
  let xml = ''
  for (let m = 1; m <= measureCount; m += 1) {
    xml += `<measure number="${m}">`
    if (m === 1) {
      xml +=
        '<attributes><divisions>1</divisions><staves>2</staves>' +
        '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
        F.soundTempo(120)
    }
    if (breakEvery && m > 1 && (m - 1) % breakEvery === 0) {
      xml += '<print new-system="yes"/>'
    }
    xml += F.fourQuarters()
    xml += '</measure>'
  }
  return parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
}

function makeSystemEntries(counts, { page = 1, weakIndex = null } = {}) {
  return counts.map((measureEstimate, systemIndex) => {
    const y0 = 0.08 + systemIndex * 0.12
    const y1 = y0 + 0.1
    return {
      page,
      contentBounds: { x0: 0.08, x1: 0.92, y0, y1 },
      system: {
        y0,
        y1,
        center: (y0 + y1) / 2,
        measureEstimate,
        barlineCount: measureEstimate + 1,
        barlineAccepted: measureEstimate + 1,
        barlineConfident: systemIndex !== weakIndex,
        barlineReliabilityReason: systemIndex === weakIndex ? 'too-dense' : 'ok',
      },
    }
  })
}

describe('calibrationWorkflow — source alignment', () => {
  it('flags measure-count mismatch for Turkish March-like totals', () => {
    const timingMap = pianoTimingMap(128)
    const entries = makeSystemEntries([
      5, 6, 6, 6, 6, 7, 4, 6, 5, 5, 5, 6, 5, 5, 6, 6, 6, 5, 4, 5, 5, 4, 4, 4, 5, 8, 8,
    ])

    const source = assessSourceAlignment({
      timingMap,
      systemEntries: entries,
      pdfPageCount: 5,
      timingSource: 'turkish-march.musicxml',
    })

    expect(source.expectedMeasures).toBe(128)
    expect(source.detectedMeasures).toBe(147)
    expect(source.indicators).toContain('measure-count-mismatch')
    expect(source.editionConflictLikely).toBe(true)
    expect(['moderate', 'severe']).toContain(source.severity)
  })

  it('detects MIDI-derived MusicXML when breaks and layout are absent', () => {
    const timingMap = pianoTimingMap(32)
    const midi = detectMidiDerivedMusicXml(timingMap)
    expect(midi.likely).toBe(true)
    expect(midi.reasons.length).toBeGreaterThan(0)
  })

  it('reports clean source alignment for matching Minuet detection', async () => {
    const timingMap = pianoTimingMap(32)
    const page = cleanPianoPage({ systems: 6, measuresPerSystem: 5 })
    const setup = await analyzeSemiAutoScoreSetup({
      pdfSource: 'synthetic',
      numPages: 1,
      timingMap,
      renderPage: renderPagesFromArray([page]),
    })

    const source = assessSourceAlignment({
      timingMap,
      systemEntries: setup.preview.systemEntries,
      pdfPageCount: 1,
    })

    expect(source.expectedMeasures).toBe(32)
    expect(Math.abs(source.measureDelta)).toBeLessThanOrEqual(source.measureTolerance)
  })
})

describe('calibrationWorkflow — hybrid calibration', () => {
  it('reconciles Turkish March-like counts and produces full anchor coverage', () => {
    const timingMap = pianoTimingMap(128)
    const entries = makeSystemEntries([
      5, 6, 6, 6, 6, 7, 4, 6, 5, 5, 5, 6, 5, 5, 6, 6, 6, 5, 4, 5, 5, 4, 4, 4, 5, 8, 8,
    ])

    const result = calibrateAnchorsHybrid({
      systemEntries: entries,
      timingMap,
      pdfPageCount: 5,
      allowReconcile: true,
      refuseOnSourceMismatch: false,
    })

    expect(result.ok).toBe(true)
    expect(result.allocationMode).toBe('hybrid-reconciled')
    expect(result.supplemental).toHaveLength(128)
    expect(result.countAnalysis.problematicSystems.length).toBeGreaterThan(0)
    expect(result.countAnalysis.suggestedCounts.reduce((a, b) => a + b, 0)).toBe(128)
  })

  it('refuses severe source mismatch without manual overrides', () => {
    const timingMap = pianoTimingMap(128)
    const entries = makeSystemEntries([
      5, 6, 6, 6, 6, 7, 4, 6, 5, 5, 5, 6, 5, 5, 6, 6, 6, 5, 4, 5, 5, 4, 4, 4, 5, 8, 8,
    ])

    const result = calibrateAnchorsHybrid({
      systemEntries: entries,
      timingMap,
      pdfPageCount: 5,
      refuseOnSourceMismatch: true,
    })

    expect(result.refused).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.refuseReason).toBe('source-mismatch')
  })

  it('accepts partial manual count overrides on problematic systems', () => {
    const timingMap = pianoTimingMap(128)
    const detected = [
      5, 6, 6, 6, 6, 7, 4, 6, 5, 5, 5, 6, 5, 5, 6, 6, 6, 5, 4, 5, 5, 4, 4, 4, 5, 8, 8,
    ]
    const entries = makeSystemEntries(detected)

    const result = calibrateAnchorsHybrid({
      systemEntries: entries,
      timingMap,
      pdfPageCount: 5,
      manualCountOverrides: { 25: 5, 26: 5 },
      refuseOnSourceMismatch: true,
    })

    expect(result.refused).toBe(false)
    expect(result.ok).toBe(true)
    expect(result.countAnalysis.problematicSystems.every((s) => s.systemIndex !== 25)).toBe(true)
  })

  it('hybrid Minuet synthetic with forced counts produces full coverage', async () => {
    const timingMap = pianoTimingMap(32)
    const page = cleanPianoPage({ systems: 6, measuresPerSystem: 5 })
    const setup = await analyzeSemiAutoScoreSetup({
      pdfSource: 'synthetic',
      numPages: 1,
      timingMap,
      renderPage: renderPagesFromArray([page]),
    })

    const calibration = calibrateAnchorsHybrid({
      systemEntries: setup.preview.systemEntries,
      timingMap,
      pdfPageCount: 1,
      forcedMeasureCounts: [5, 5, 6, 5, 5, 6],
      refuseOnSourceMismatch: false,
    })

    expect(calibration.ok).toBe(true)
    expect(calibration.supplemental).toHaveLength(32)
    const readiness = assessCalibrationReadiness({ calibrationResult: calibration })
    expect([PROMOTION_STATUS.READY, PROMOTION_STATUS.NEEDS_REVIEW]).toContain(readiness.status)
  })

  it('round-trip Minuet manual table diagnostics are READY', () => {
    const systems = manualSystemsFromBundledPayload(minuetReference)
    const payload = buildBundledAnchorsFromManualSystems(systems, {
      pieceId: minuetReference.pieceId,
    })
    const calibration = {
      ok: true,
      supplemental: payload.anchors,
      allocationMode: 'manual',
      warnings: [],
      source: { expectedMeasures: 32, detectedMeasures: 32, measureDelta: 0, severity: 'none' },
      countAnalysis: { problematicSystems: [], perSystem: [] },
    }
    const report = buildCalibrationDiagnostics({
      calibrationResult: calibration,
      payload,
      referencePayload: minuetReference,
    })

    expect(report.readiness.status).toBe(PROMOTION_STATUS.READY)
    expect(formatCalibrationDiagnosticsText(report)).toContain('Calibration diagnostics')
  })
})

describe('calibrationWorkflow — system analysis', () => {
  it('suggests extra barlines on dense systems', () => {
    const timingMap = pianoTimingMap(30)
    const entries = makeSystemEntries([6, 6, 6, 6, 6], { weakIndex: 2 })

    const analysis = analyzeSystemMeasureCounts({
      systemEntries: entries,
      timingMap,
      detectedCounts: [6, 6, 8, 6, 6],
    })

    expect(analysis.extraBarlineEstimate).toBe(2)
    expect(analysis.problematicSystems.some((s) => s.systemIndex === 2)).toBe(true)
    expect(analysis.suggestedCounts.reduce((a, b) => a + b, 0)).toBe(30)
  })

  it('dense synthetic page hybrid calibration completes with NEEDS_REVIEW or better', async () => {
    const timingMap = pianoTimingMap(30, { breakEvery: 6 })
    const page = densePianoPage({ systems: 5, measuresPerSystem: 6 })
    const setup = await analyzeSemiAutoScoreSetup({
      pdfSource: 'synthetic',
      numPages: 1,
      timingMap,
      renderPage: renderPagesFromArray([page]),
    })

    const result = calibrateAnchorsHybrid({
      systemEntries: setup.preview.systemEntries,
      timingMap,
      pdfPageCount: 1,
      forcedMeasureCounts: [6, 6, 6, 6, 6],
      refuseOnSourceMismatch: false,
    })

    const readiness = assessCalibrationReadiness({ calibrationResult: result })
    expect(result.supplemental.length).toBe(30)
    expect([PROMOTION_STATUS.READY, PROMOTION_STATUS.NEEDS_REVIEW]).toContain(readiness.status)
  })
})

describe('calibrationWorkflow — metadata fixtures', () => {
  it('documents Turkish March as metadata-only with confirm action', () => {
    const turkish = METADATA_FIXTURES.find((f) => f.id === 'turkish-march')
    expect(turkish).toBeDefined()
    expect(turkish.redistributable).toBe(true)
    expect(turkish.bundled).toBe(false)
    expect(turkish.documented.expectedAction).toBe('confirm')
  })
})
