/**
 * Hungarian Dance-style dense piano detection — thin staff lines under heavy
 * notation. Uses a synthetic fixture (license-safe) and optionally a real PDF
 * when HUNGARIAN_DANCE_PDF_PATH is set (local dev only; not bundled).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  analyzeSemiAutoScoreSetup,
  DETECTION_STAGE,
} from '../src/features/score-follow/semiAutoScoreAlignment.js'
import {
  buildStaffDetectionDiagnostics,
  detectStaffLineStaves,
  detectStaffLineSystems,
} from '../src/features/score-follow/detectStaffLines.js'
import { detectContentBounds } from '../src/features/score-follow/detectStaffSystems.js'
import {
  cleanPianoPage,
  hungarianDanceStylePage,
  renderPagesFromArray,
} from './helpers/syntheticScore.js'
import * as F from './helpers/buildXml.js'

const ANALYSIS_WIDTH = 1000
const optionalPdfPath = globalThis.process?.env?.HUNGARIAN_DANCE_PDF_PATH ?? ''

function pianoTimingMap(measureCount, beats = 2) {
  let xml = ''
  for (let m = 1; m <= measureCount; m += 1) {
    xml += `<measure number="${m}">`
    if (m === 1) {
      xml +=
        `<attributes><divisions>1</divisions><staves>2</staves>` +
        `<time><beats>${beats}</beats><beat-type>4</beat-type></time>` +
        `<clef><sign>G</sign><line>2</line></clef></attributes>` +
        F.soundTempo(108)
    }
    xml += F.fourQuarters()
    xml += `</measure>`
  }
  return parseMusicXml(F.scoreWrap(`<part id="P1">${xml}</part>`))
}

describe('Hungarian Dance-style synthetic fixture', () => {
  const page = hungarianDanceStylePage({ systems: 5, measuresPerSystem: 4 })
  const bounds = detectContentBounds(page)

  it('detects staves via the faint-line pass (not only tolerant fallback)', () => {
    const staves = detectStaffLineStaves(page, bounds)
    expect(staves.length).toBeGreaterThanOrEqual(5)
    expect(detectStaffLineStaves.lastTrace?.accepted).toBe(true)
    expect(detectStaffLineStaves.lastTrace?.pass).toBe('faint-broken-lines')
  })

  it('groups into five grand-staff systems', () => {
    const { systems } = detectStaffLineSystems(page, bounds, { stavesPerSystem: 2 })
    expect(systems.length).toBeGreaterThanOrEqual(4)
    expect(systems.length).toBeLessThanOrEqual(6)
  })

  it('auto setup never reports no-systems', async () => {
    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'hungarian-style',
      numPages: 1,
      timingMap: pianoTimingMap(20),
      renderPage: renderPagesFromArray([page]),
    })
    expect(result.ok).toBe(true)
    expect(result.noSystems).toBeFalsy()
    expect(result.preview.systemCount).toBeGreaterThanOrEqual(4)
    expect(result.preview.stage).toBe(DETECTION_STAGE.STAFF_LINES)
  })

  it('emits staff detection diagnostics with preprocessing stats', () => {
    const diagnostics = buildStaffDetectionDiagnostics(page, { stavesPerSystem: 2 })
    expect(diagnostics.preprocessing.inkRatio).toBeGreaterThan(0.05)
    expect(diagnostics.preprocessing.adaptiveThreshold).toBeGreaterThan(0)
    expect(diagnostics.staffLines.systemCount).toBeGreaterThanOrEqual(4)
    expect(diagnostics.chosenStage).toBe('staff-lines')
    expect(diagnostics.staffLines.trace?.passHistory?.length).toBeGreaterThanOrEqual(3)
  })
})

describe('regression: clean Minuet-style page unchanged', () => {
  it('still detects staff lines on dark engraving', () => {
    const page = cleanPianoPage({ systems: 6, measuresPerSystem: 4 })
    const bounds = detectContentBounds(page)
    const { systems } = detectStaffLineSystems(page, bounds, { stavesPerSystem: 2 })
    expect(systems.length).toBe(6)
    expect(detectStaffLineStaves.lastTrace?.pass).toBe('strict-run')
  })
})

let optionalReady = false
let optionalSkipReason = ''
let optionalPages = []

if (optionalPdfPath) {
  try {
    const { createCanvas } = await import('@napi-rs/canvas')
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(readFileSync(optionalPdfPath))
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: ANALYSIS_WIDTH / base.width })
      const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
      const context = canvas.getContext('2d')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: context, viewport }).promise
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
      optionalPages.push({
        width: imageData.width,
        height: imageData.height,
        data: imageData.data,
      })
    }
    optionalReady = optionalPages.length > 0
  } catch (error) {
    optionalSkipReason = error instanceof Error ? error.message : String(error)
  }
}

const maybeOptional = optionalReady ? it : it.skip

if (optionalPdfPath && !optionalReady) {
  console.warn(
    `[hungarianDanceAutoSetup] optional real PDF skipped (${optionalSkipReason || 'unreadable'})`,
  )
}

describe('optional real Hungarian Dance PDF (HUNGARIAN_DANCE_PDF_PATH)', () => {
  maybeOptional('detects multiple staff-line systems on page 1', () => {
    const diagnostics = buildStaffDetectionDiagnostics(optionalPages[0], { stavesPerSystem: 2 })
    expect(diagnostics.staffLines.systemCount).toBeGreaterThanOrEqual(4)
    expect(diagnostics.chosenStage).toBe('staff-lines')
  })

  maybeOptional('auto setup succeeds across all pages', async () => {
    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'hungarian-real',
      numPages: optionalPages.length,
      timingMap: pianoTimingMap(104),
      renderPage: renderPagesFromArray(optionalPages),
    })
    expect(result.ok).toBe(true)
    expect(result.noSystems).toBeFalsy()
    expect(result.preview.systemCount).toBeGreaterThanOrEqual(10)
  })
})
