import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { analyzeSemiAutoScoreSetup } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import {
  buildBundledAnchorsFromAutoAnchors,
  buildBundledAnchorsFromManualSystems,
  calibrateAnchorsFromDetection,
  compareBundledAnchorsToReference,
  manualSystemsFromBundledPayload,
  validateBundledAnchorPayload,
  CALIBRATION_SOURCE,
  PROMOTION_STATUS,
} from '../src/features/score-follow/demoAnchorCalibration.js'
import { cleanPianoPage, renderPagesFromArray } from './helpers/syntheticScore.js'
import * as F from './helpers/buildXml.js'

const minuetReferencePath = fileURLToPath(
  new URL('../public/fixtures/demo-minuet-in-g.anchors.json', import.meta.url),
)
const minuetReference = JSON.parse(readFileSync(minuetReferencePath, 'utf8'))

describe('demoAnchorCalibration', () => {
  it('round-trips bundled Minuet anchors through manual system tables', () => {
    const systems = manualSystemsFromBundledPayload(minuetReference)
    expect(systems).toHaveLength(6)
    expect(systems[0].measures).toHaveLength(5)

    const rebuilt = buildBundledAnchorsFromManualSystems(systems, {
      pieceId: minuetReference.pieceId,
      pdfFile: minuetReference.pdfFile,
      timingFile: minuetReference.timingFile,
      calibrated: 'pymupdf-barline',
      alignmentNote: minuetReference.alignmentNote,
    })

    const { comparison, readiness } = compareBundledAnchorsToReference(rebuilt, minuetReference)
    expect(readiness.status).toBe(PROMOTION_STATUS.READY)
    expect(comparison.maxError).toBe(0)
    expect(comparison.avgError).toBe(0)
  })

  it('validateBundledAnchorPayload accepts Minuet reference', () => {
    const result = validateBundledAnchorPayload(minuetReference, { pieceId: 'minuet-in-g' })
    expect(result.ok).toBe(true)
    expect(result.anchors).toHaveLength(32)
  })

  it('buildBundledAnchorsFromAutoAnchors uses playableStartX for cursor x', () => {
    const bundled = buildBundledAnchorsFromAutoAnchors(
      [
        {
          page: 1,
          x: 0.28,
          y: 0.2,
          measureNumber: 1,
          source: 'auto-measure',
          meta: {
            role: 'measure',
            measureStartX: 0.12,
            playableStartX: 0.28,
            playableEndX: 0.45,
            systemEndX: 0.95,
          },
        },
      ],
      { pieceId: 'test', calibrated: CALIBRATION_SOURCE.AUTO },
    )
    expect(bundled.anchors[0].x).toBe(0.28)
    expect(bundled.anchors[0].meta.measureStartX).toBe(0.12)
  })

  it('calibrateAnchorsFromDetection builds full measure coverage on synthetic PDF', async () => {
    const page = cleanPianoPage({ systems: 3, measuresPerSystem: 4 })
    const timingMap = parseMusicXml(
      F.scoreWrap(
        `<part id="P1">${Array.from({ length: 12 }, (_, i) => {
          const m = i + 1
          let xml = `<measure number="${m}">`
          if (m === 1) {
            xml +=
              '<attributes><divisions>1</divisions><staves>2</staves>' +
              '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
              F.soundTempo(120)
          }
          if (m > 1 && (m - 1) % 4 === 0) xml += '<print new-system="yes"/>'
          return xml + F.fourQuarters() + '</measure>'
        }).join('')}</part>`,
      ),
    )

    const setup = await analyzeSemiAutoScoreSetup({
      pdfSource: 'synthetic',
      numPages: 1,
      timingMap,
      renderPage: renderPagesFromArray([page]),
    })

    expect(setup.ok).toBe(true)

    const calibration = calibrateAnchorsFromDetection({
      systemEntries: setup.preview.systemEntries,
      timingMap,
      forcedMeasureCounts: [4, 4, 4],
    })

    expect(calibration.ok).toBe(true)
    expect(calibration.supplemental).toHaveLength(12)

    const bundled = buildBundledAnchorsFromAutoAnchors(calibration.supplemental, {
      pieceId: 'synthetic-clean',
      pdfFile: 'synthetic.pdf',
      timingFile: 'synthetic.musicxml',
      calibrated: CALIBRATION_SOURCE.AUTO,
    })

    expect(bundled.anchors).toHaveLength(12)
    expect(bundled.anchors[0].meta.measureStartX).toBeDefined()
    expect(bundled.anchors[0].meta.playableEndX).toBeDefined()
    expect(bundled.anchors[0].meta.systemEndX).toBeDefined()
    expect(bundled.calibration.source).toBe(CALIBRATION_SOURCE.AUTO)
  })

  it('reports failure when forced counts do not match measure total', () => {
    const timingMap = parseMusicXml(
      F.scoreWrap(
        `<part id="P1"><measure number="1">${F.attributes() + F.soundTempo(120) + F.fourQuarters()}</measure></part>`,
      ),
    )
    const calibration = calibrateAnchorsFromDetection({
      systemEntries: [{ page: 1, system: { center: 0.2, measureEstimate: 1 } }],
      timingMap,
      forcedMeasureCounts: [2],
    })
    expect(calibration.ok).toBe(false)
    expect(calibration.warnings.some((w) => w.includes('Forced measure counts'))).toBe(true)
  })
})
