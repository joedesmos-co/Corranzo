/**
 * Real-PDF auto-setup test — renders the bundled public-domain Minuet in G
 * (real sheet music, 6 grand-staff systems, 32 measures) through the actual
 * pipeline and asserts an approximate cursor is produced automatically.
 *
 * This is a genuine user-style case: the demo MusicXML is MIDI-derived, so it
 * has NO system-break or default-x layout hints — exactly the scenario where
 * pixel-based detection must carry the mapping.
 *
 * Rendering needs a Node canvas (@napi-rs/canvas) + pdfjs. Where neither is
 * available (e.g. a Linux CI sandbox without the native binding) the test
 * skips cleanly; on the user's machine it runs against real pixels.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  analyzeSemiAutoScoreSetup,
} from '../src/features/score-follow/semiAutoScoreAlignment.js'
import {
  detectConservativeStaffSystems,
  detectTolerantStaffSystems,
} from '../src/features/score-follow/detectStaffSystems.js'
import { assessScoreFollowTrust } from '../src/features/score-follow/scoreFollowTrust.js'
import { resolveScoreFollowCursor } from '../src/features/score-follow/resolveScoreFollowCursor.js'
import { renderPagesFromArray } from './helpers/syntheticScore.js'

const pdfPath = fileURLToPath(
  new URL('../public/fixtures/demo-minuet-in-g.pdf', import.meta.url),
)
const xmlPath = fileURLToPath(
  new URL('../public/fixtures/demo-minuet-in-g.musicxml', import.meta.url),
)

const ANALYSIS_WIDTH = 520

let ready = false
let skipReason = ''
let pages = []
let timingMap = null

try {
  const { createCanvas } = await import('@napi-rs/canvas')
  // Smoke-test the 2D context before committing to a full render.
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
    await page.render({ canvasContext: context, viewport }).promise
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    pages.push({ width: imageData.width, height: imageData.height, data: imageData.data })
  }

  timingMap = parseMusicXml(readFileSync(xmlPath, 'utf8'))
  ready = pages.length > 0 && Boolean(timingMap?.measures?.length)
} catch (error) {
  skipReason = error instanceof Error ? error.message : String(error)
}

if (!ready) {
  console.warn(`[realPdfAutoSetup] skipped — no Node canvas/pdfjs available: ${skipReason}`)
}

const maybe = ready ? it : it.skip

describe('real PDF (Minuet in G) — automatic score-follow setup', () => {
  maybe('detects multiple staff systems on the real engraved page', () => {
    const conservative = detectConservativeStaffSystems(pages[0])
    const tolerant = detectTolerantStaffSystems(pages[0])
    const best = Math.max(conservative.length, tolerant.length)
    // The page has six grand-staff systems; allow some slack for scan quality.
    expect(best).toBeGreaterThanOrEqual(3)
  })

  maybe('produces an approximate cursor automatically (no manual marking)', async () => {
    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'minuet',
      numPages: pages.length,
      timingMap,
      renderPage: renderPagesFromArray(pages),
    })

    expect(result.ok).toBe(true)
    expect(result.preview.systemCount).toBeGreaterThanOrEqual(3)
    expect(result.preview.proposedAnchors.length).toBeGreaterThanOrEqual(2)

    const trust = assessScoreFollowTrust({
      anchors: result.preview.proposedAnchors,
      timingMap,
    })
    expect(trust.showCursor).toBe(true)
    expect(trust.needsSetup).toBe(false)

    const atStart = resolveScoreFollowCursor({
      timingMap,
      practiceTime: 0,
      trustedAnchors: result.preview.proposedAnchors,
      trust,
    })
    expect(atStart.cursor.visible).toBe(true)
  })

  maybe('maps all 32 written measures within the detected anchor span', async () => {
    const result = await analyzeSemiAutoScoreSetup({
      pdfSource: 'minuet',
      numPages: pages.length,
      timingMap,
      renderPage: renderPagesFromArray(pages),
    })
    const measureNumbers = result.preview.proposedAnchors.map((a) => a.measureNumber)
    expect(Math.min(...measureNumbers)).toBe(1)
    // The last system-end anchor should reach the final measures of the piece.
    expect(Math.max(...measureNumbers)).toBeGreaterThanOrEqual(28)
  })
})
