import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { DEMO_PIECE, FIXTURE_FILENAMES, FIXTURE_PATHS } from '../src/dev/fixturePaths.js'
import { isDemoFixtureFileSet } from '../src/features/demo/demoBundledAnchors.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { analyzeSemiAutoScoreSetup } from '../src/features/score-follow/semiAutoScoreAlignment.js'
import {
  assessBundledMeasureCursorX,
  validateBundledAnchorPayload,
} from '../src/features/score-follow/demoAnchorCalibration.js'
import { renderPagesFromArray } from './helpers/syntheticScore.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = join(root, 'public')
const ANALYSIS_WIDTH = 1000

function fixturePath(urlPath) {
  return join(publicRoot, urlPath.replace(/^\//, ''))
}

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
  return parseMusicXml(xml, 'hungarian-dance-no5.mxl')
}

async function rasterizePdfPages(pdfPath) {
  const { createCanvas } = await import('@napi-rs/canvas')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const pages = []
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
    pages.push({
      width: imageData.width,
      height: imageData.height,
      data: imageData.data,
    })
  }
  return pages
}

describe('Hungarian Dance demo fixtures', () => {
  it('exposes Hungarian Dance as the built-in demo piece', () => {
    expect(DEMO_PIECE.id).toBe('hungarian-dance-no5')
    expect(DEMO_PIECE.title).toContain('Hungarian Dance')
    expect(DEMO_PIECE.measureCount).toBe(104)
    expect(DEMO_PIECE.pageCount).toBe(4)
  })

  it('ships pdf, mxl, and midi on disk', () => {
    for (const path of [FIXTURE_PATHS.pdf, FIXTURE_PATHS.midi, FIXTURE_PATHS.musicXml]) {
      expect(existsSync(fixturePath(path)), path).toBe(true)
    }
  })

  it('ships validated auto-preview bundled anchors (not hybrid-reconciled)', () => {
    const anchorsPath = fixturePath(FIXTURE_PATHS.demoAnchors)
    expect(existsSync(anchorsPath)).toBe(true)
    const payload = JSON.parse(readFileSync(anchorsPath, 'utf8'))
    expect(payload.alignmentNote).not.toContain('hybrid-reconciled')
    const result = validateBundledAnchorPayload(payload, { pieceId: DEMO_PIECE.id })
    expect(result.ok).toBe(true)
    expect(result.anchors).toHaveLength(104)
    const measureOne = result.anchors.find((anchor) => anchor.measureNumber === 1)
    expect(measureOne.x).toBeGreaterThan(0.16)
    expect(assessBundledMeasureCursorX(measureOne).ok).toBe(true)
  })

  it('recognizes the demo file set by filename', () => {
    expect(
      isDemoFixtureFileSet(FIXTURE_FILENAMES.pdf, FIXTURE_FILENAMES.musicXml),
    ).toBe(true)
  })

  it('rejects measure-1 anchors parked on the clef margin', () => {
    const bad = {
      pieceId: 'hungarian-dance-no5',
      anchors: [
        {
          page: 1,
          x: 0.12,
          y: 0.2,
          measureNumber: 1,
          meta: {
            role: 'measure',
            measureStartX: 0.12,
            playableStartX: 0.25,
            playableEndX: 0.4,
            systemEndX: 0.95,
          },
        },
        { page: 1, x: 0.4, y: 0.2, measureNumber: 2, meta: { role: 'measure' } },
      ],
    }
    expect(validateBundledAnchorPayload(bad).reason).toBe('cursor-before-playable-start')
    expect(
      assessBundledMeasureCursorX(bad.anchors[0]).reason,
    ).toBe('cursor-before-playable-start')
  })

  it('auto-setup on public fixtures places measure 1 in the playable area', async () => {
    const pdfPath = fixturePath(FIXTURE_PATHS.pdf)
    const mxlPath = fixturePath(FIXTURE_PATHS.musicXml)
    const [pages, timingMap] = await Promise.all([
      rasterizePdfPages(pdfPath),
      loadMxlTimingMap(mxlPath),
    ])

    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'hungarian-demo-fixture',
      numPages: pages.length,
      timingMap,
      renderPage: renderPagesFromArray(pages),
    })

    expect(result.ok).toBe(true)
    expect(result.preview.supplementalMeasureAnchors.length).toBe(104)

    const measureOne =
      result.preview.supplementalMeasureAnchors.find((anchor) => anchor.measureNumber === 1) ??
      result.preview.proposedAnchors.find((anchor) => anchor.measureNumber === 1)
    expect(measureOne).toBeTruthy()
    expect(measureOne.page).toBe(1)
    expect(assessBundledMeasureCursorX(measureOne).ok).toBe(true)
    expect(measureOne.x).toBeGreaterThan(0.16)

    const pagesWithAnchors = new Set(result.preview.proposedAnchors.map((anchor) => anchor.page))
    expect(pagesWithAnchors.size).toBe(4)
  }, 120_000)
})
