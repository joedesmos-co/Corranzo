/**
 * Spider Dance (Undertale) calibration regression — dense beamed piano texture
 * where barline detection and strategy selection used to underperform.
 *
 * Skips when Node canvas / pdfjs are unavailable (same guard as realPdfAutoSetup).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { analyzeSemiAutoScoreSetup } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import { renderPagesFromArray } from './helpers/syntheticScore.js'

const pdfPath = fileURLToPath(
  new URL('../public/fixtures/spider-dance-undertale.pdf', import.meta.url),
)
const mxlPath = fileURLToPath(
  new URL('../public/fixtures/spider-dance-undertale.mxl', import.meta.url),
)

const ANALYSIS_WIDTH = 1000

async function loadMxlTimingMap(path) {
  const zip = await JSZip.loadAsync(readFileSync(path))
  const container = zip.file('META-INF/container.xml')
  let rootPath = null
  if (container) {
    const match = (await container.async('string')).match(/full-path="([^"]+)"/)
    rootPath = match?.[1] ?? null
  }
  if (!rootPath || !zip.file(rootPath)) {
    rootPath = Object.keys(zip.files).find(
      (name) => name.endsWith('.xml') && !name.startsWith('META-INF'),
    )
  }
  const xml = await zip.file(rootPath).async('string')
  return parseMusicXml(xml, 'spider-dance-undertale.mxl')
}

let ready = false
let skipReason = ''
let pages = []
let timingMap = null

try {
  const { createCanvas } = await import('@napi-rs/canvas')
  const smoke = createCanvas(4, 4).getContext('2d')
  smoke.fillStyle = 'white'
  smoke.fillRect(0, 0, 4, 4)
  smoke.getImageData(0, 0, 4, 4)

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = fileURLToPath(
      new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url),
    )
  } catch {
    // fall back to fake worker
  }

  const data = new Uint8Array(readFileSync(pdfPath))
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
    pages.push({ width: imageData.width, height: imageData.height, data: imageData.data })
  }

  timingMap = await loadMxlTimingMap(mxlPath)
  ready = pages.length > 0 && Boolean(timingMap?.measures?.length)
} catch (error) {
  skipReason = error instanceof Error ? error.message : String(error)
}

if (!ready) {
  console.warn(`[spiderDanceCalibration] skipped — no Node canvas/pdfjs available: ${skipReason}`)
}

const maybe = ready ? it : it.skip

describe('Spider Dance calibration regression (real PDF)', () => {
  maybe('chooses the highest-scoring calibration strategy', async () => {
    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'spider-dance',
      numPages: pages.length,
      timingMap,
      renderPage: renderPagesFromArray(pages),
    })

    expect(result.ok).toBe(true)
    const report = result.preview.smartCalibration
    expect(report?.active).toBe(true)

    const scores = report.strategyScores ?? []
    const top = scores.reduce(
      (winner, entry) => (entry.overall > winner.overall ? entry : winner),
      scores[0],
    )
    expect(report.chosenStrategy).toBe(top.strategy)
  })

  maybe('detects usable barlines on dense beamed pages without regressing', async () => {
    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'spider-dance',
      numPages: pages.length,
      timingMap,
      renderPage: renderPagesFromArray(pages),
    })

    const systems = result.preview.debugReport?.systems ?? []
    expect(systems.length).toBeGreaterThanOrEqual(8)

    const tooFew = systems.filter((s) => s.barlineReliabilityReason === 'too-few-barlines')
    const confident = systems.filter((s) => s.barlineConfident === true)
    expect(confident.length).toBeGreaterThanOrEqual(6)
    expect(tooFew.length).toBeLessThanOrEqual(12)
  })

  maybe('penalizes sparse barline systems in per-system confidence', async () => {
    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'spider-dance',
      numPages: pages.length,
      timingMap,
      renderPage: renderPagesFromArray(pages),
    })

    const report = result.preview.smartCalibration
    const systems = result.preview.debugReport?.systems ?? []
    const perSystem = new Map((report.perSystemConfidence ?? []).map((s) => [s.index, s.confidence]))

    for (const system of systems) {
      if (system.barlineReliabilityReason !== 'too-few-barlines') {
        continue
      }
      const confidence = perSystem.get(system.index)
      expect(confidence).toBeLessThan(0.35)
    }
  })
})
