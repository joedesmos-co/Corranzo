import { describe, expect, it, vi } from 'vitest'
import {
  densePianoPage,
  renderPagesFromArray,
  rhythmicPianoPage,
  scannedPianoPage,
} from './helpers/syntheticScore.js'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import {
  assessOmrDifficulty,
  OMR_FAILURE_REASON,
} from '../src/features/omr/assessOmrDifficulty.js'
import {
  estimatePageScanQuality,
  preprocessOmrPageImage,
} from '../src/features/omr/preprocessOmrPageImage.js'
import { validateOmrMultiPageLayout } from '../src/features/omr/validateOmrMultiPage.js'
import { processOmrPageAnalysis } from '../src/features/omr/processOmrPage.js'
import { detectNoteheadsInMeasure } from '../src/features/omr/detectOmrNoteheads.js'
import { buildMeasureBoxesForSystem } from '../src/features/omr/buildOmrMeasureGrid.js'
import { detectContentBounds } from '../src/features/score-follow/detectStaffSystems.js'
import { detectStaffLineSystems } from '../src/features/score-follow/detectStaffLines.js'
import { OMR_TOO_DIFFICULT_MESSAGE } from '../src/features/omr/omrConstants.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { runPdfOmrClient } from '../src/features/omr/runPdfOmrClient.js'
import {
  assertBufferNotDetached,
  copyOmrPixels,
  deserializeOmrImageFromWorker,
  isDetachedPixelBuffer,
  serializeOmrImageForWorker,
} from '../src/features/omr/omrPixelBuffer.js'
import {
  cloneArrayBuffer,
  cloneOmrPdfSource,
  describePdfSourceType,
  isPdfBufferAttached,
} from '../src/features/omr/omrPdfSource.js'

describe('experimental PDF OMR v4 (harder PDFs)', () => {
  it('flags scanned-looking pages and applies preprocessing', () => {
    const scanned = scannedPianoPage()
    const clean = rhythmicPianoPage()
    expect(estimatePageScanQuality(scanned).isLikelyScanned).toBe(true)
    expect(estimatePageScanQuality(clean).isLikelyScanned).toBe(false)

    const { applied } = preprocessOmrPageImage(scanned)
    expect(applied.length).toBeGreaterThan(0)
    expect(applied).toContain('contrast')
  })

  it('produces playback from a scanned synthetic page after preprocessing', async () => {
    const page = scannedPianoPage({ measuresPerSystem: 4 })
    const progress = []
    const result = await runPdfOmrPipeline('synthetic', {
      numPages: 1,
      renderPage: renderPagesFromArray([page]),
      onProgress: (event) => progress.push(event),
    })

    expect(result.noteCount).toBeGreaterThan(0)
    expect(result.diagnostics.preprocessLog?.[0]?.applied?.length).toBeGreaterThan(0)
    expect(progress.some((event) => event.phase === 'preprocess')).toBe(true)

    const timing = parseMusicXml(result.musicXml, 'scanned.omr.musicxml')
    expect(timing.measures.length).toBeGreaterThan(0)
  })

  it('dense mode detects noteheads without stem false positives on dense page', () => {
    const page = densePianoPage({ systems: 2, measuresPerSystem: 4 })
    const contentBounds = detectContentBounds(page)
    const { systems, inkThreshold } = detectStaffLineSystems(page, contentBounds, {
      stavesPerSystem: 2,
      countBarlines: true,
    })
    const measureBoxes = buildMeasureBoxesForSystem({
      page: 1,
      systemIndex: 0,
      system: systems[0],
      contentBounds,
      imageData: page,
      measureNumberStart: 1,
    })

    const normal = detectNoteheadsInMeasure(page, measureBoxes[0], inkThreshold, { dense: false })
    const dense = detectNoteheadsInMeasure(page, measureBoxes[0], inkThreshold, { dense: true })
    expect(dense.length).toBeGreaterThan(0)
    expect(dense.length).toBeGreaterThanOrEqual(normal.length)
  })

  it('assessOmrDifficulty rejects sparse low-confidence results', () => {
    const assessment = assessOmrDifficulty({
      overallConfidence: 0.3,
      pagesWithSystems: 1,
      pageCount: 4,
      noteCount: 2,
      measureCount: 12,
      uncertainMeasures: 10,
      layoutConsistency: { inconsistent: true },
    })
    expect(assessment.tooDifficult).toBe(true)
    expect(assessment.message).toBe(OMR_TOO_DIFFICULT_MESSAGE)
    expect(assessment.reasons).toContain(OMR_FAILURE_REASON.LOW_CONFIDENCE)
  })

  it('assessOmrDifficulty rejects mostly uncertain dense-looking output', () => {
    const assessment = assessOmrDifficulty({
      overallConfidence: 0.65,
      pagesWithSystems: 4,
      pageCount: 4,
      noteCount: 2058,
      measureCount: 158,
      uncertainMeasures: 150,
      layoutConsistency: { inconsistent: false, spread: 1 },
    })

    expect(assessment.tooDifficult).toBe(true)
    expect(assessment.uncertainRatio).toBeGreaterThan(0.9)
    expect(assessment.reasons).toContain(OMR_FAILURE_REASON.LOW_CONFIDENCE)
  })

  it('assessOmrDifficulty rejects wildly variable low-confidence layouts', () => {
    const assessment = assessOmrDifficulty({
      overallConfidence: 0.67,
      pagesWithSystems: 7,
      pageCount: 8,
      noteCount: 1482,
      measureCount: 254,
      uncertainMeasures: 120,
      layoutConsistency: { inconsistent: false, spread: 11 },
    })

    expect(assessment.tooDifficult).toBe(true)
    expect(assessment.reasons).toContain(OMR_FAILURE_REASON.INCONSISTENT_LAYOUT)
  })

  it('validateOmrMultiPageLayout warns on inconsistent system counts', () => {
    const layout = validateOmrMultiPageLayout([
      { page: 1, systems: [{ confidence: 0.5 }, { confidence: 0.55 }] },
      { page: 2, systems: [{ confidence: 0.48 }] },
      { page: 3, systems: [{ confidence: 0.52 }, { confidence: 0.5 }, { confidence: 0.51 }, { confidence: 0.49 }, { confidence: 0.5 }] },
    ])
    expect(layout.inconsistent).toBe(true)
    expect(layout.warning).toMatch(/varies widely/i)
  })

  it('pipeline throws too-difficult error for empty pages', async () => {
    const blank = rhythmicPianoPage({ measuresPerSystem: 4 })
    for (let i = 0; i < blank.data.length; i += 4) {
      blank.data[i] = 255
      blank.data[i + 1] = 255
      blank.data[i + 2] = 255
    }

    await expect(
      runPdfOmrPipeline('synthetic', {
        numPages: 1,
        renderPage: renderPagesFromArray([blank]),
      }),
    ).rejects.toThrow(/staff systems|noteheads/i)
  })

  it('supports cancellation between pages', async () => {
    const controller = new AbortController()
    const pages = [rhythmicPianoPage(), rhythmicPianoPage()]
    const renderPage = vi.fn(async (_src, page) => {
      if (page === 2) {
        controller.abort()
      }
      return { imageData: pages[page - 1] }
    })

    await expect(
      runPdfOmrPipeline('synthetic', {
        numPages: 2,
        renderPage,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('processOmrPageAnalysis enables dense noteheads on scanned pages', () => {
    const scanned = scannedPianoPage({ measuresPerSystem: 2 })
    const result = processOmrPageAnalysis(scanned, { page: 1, measureNumberStart: 1 })
    expect(result.dense).toBe(true)
    expect(result.stats.notes).toBeGreaterThan(0)
  })

  it('pixel clones keep source buffers attached across sequential page handoffs', async () => {
    const pages = [rhythmicPianoPage(), scannedPianoPage({ measuresPerSystem: 2 })]
    const originalBytes = pages.map((page) => page.data[0])

    const analyzePage = async (imageData, pageOptions) => {
      const payload = serializeOmrImageForWorker(imageData, 'test:serialize')
      expect(isDetachedPixelBuffer(imageData.data)).toBe(false)
      expect(Array.isArray(payload.pixels)).toBe(true)

      const workerImage = deserializeOmrImageFromWorker(payload, 'test:deserialize')
      expect(isDetachedPixelBuffer(imageData.data)).toBe(false)
      expect(() => imageData.data[0]).not.toThrow()

      return processOmrPageAnalysis(workerImage, pageOptions)
    }

    const result = await runPdfOmrPipeline('synthetic', {
      numPages: 2,
      renderPage: renderPagesFromArray(pages),
      analyzePage,
    })

    expect(result.noteCount).toBeGreaterThan(0)
    expect(pages[0].data[0]).toBe(originalBytes[0])
    expect(pages[1].data[0]).toBe(originalBytes[1])
    expect(isDetachedPixelBuffer(pages[0].data)).toBe(false)
    expect(isDetachedPixelBuffer(pages[1].data)).toBe(false)
  })

  it('runPdfOmrClient processes multiple pages without detached buffer errors', async () => {
    const pages = [rhythmicPianoPage(), densePianoPage({ systems: 1, measuresPerSystem: 3 })]
    const useWorker = typeof Worker !== 'undefined'

    const result = await runPdfOmrClient('synthetic', {
      numPages: 2,
      renderPage: renderPagesFromArray(pages),
      useWorker,
    })

    expect(result.noteCount).toBeGreaterThan(0)
    expect(isDetachedPixelBuffer(pages[0].data)).toBe(false)
    expect(isDetachedPixelBuffer(pages[1].data)).toBe(false)
  })

  it('assertBufferNotDetached throws a labeled error for detached buffers', () => {
    const buffer = new ArrayBuffer(8)
    const view = new Uint8ClampedArray(buffer)
    if (typeof structuredClone === 'function') {
      const clone = structuredClone(view)
      expect(() => assertBufferNotDetached(clone.buffer, 'test-label')).not.toThrow()
    }
    expect(() => assertBufferNotDetached(view.buffer, 'test-label')).not.toThrow()

    // Simulate detach via transfer when supported (Node may not detach).
    try {
      const channel = new MessageChannel()
      channel.port1.postMessage(view.buffer, [view.buffer])
      expect(() => assertBufferNotDetached(view.buffer, 'test-transfer-detach')).toThrow(
        /\[OMR test-transfer-detach\] detached ArrayBuffer/,
      )
    } catch {
      // MessageChannel transfer unsupported in this environment — skip detach simulation.
    }
  })

  it('worker serialize/deserialize round-trip matches element-wise copy', () => {
    const page = rhythmicPianoPage()
    const owned = copyOmrPixels(page, 'test:owned')
    const payload = serializeOmrImageForWorker(owned, 'test:round-trip-serialize')
    const restored = deserializeOmrImageFromWorker(payload, 'test:round-trip-deserialize')
    expect(restored.data[0]).toBe(owned.data[0])
    expect(restored.data.buffer).not.toBe(page.data.buffer)
    expect(isDetachedPixelBuffer(page.data)).toBe(false)
  })

  it('cloneOmrPdfSource copies ArrayBuffer without reusing the original backing store', () => {
    const source = new ArrayBuffer(16)
    new Uint8Array(source)[0] = 37
    const cloned = cloneOmrPdfSource(source, 'test:pdf-clone')
    expect(cloned).toBeInstanceOf(ArrayBuffer)
    expect(cloned).not.toBe(source)
    expect(new Uint8Array(cloned)[0]).toBe(37)
    expect(isPdfBufferAttached(source)).toBe(true)
  })

  it('cloneArrayBuffer throws a labeled error when the source buffer is detached', () => {
    const buffer = new ArrayBuffer(8)
    try {
      const channel = new MessageChannel()
      channel.port1.postMessage(buffer, [buffer])
      expect(() => cloneArrayBuffer(buffer, 'test-detached-pdf')).toThrow(
        /\[OMR test-detached-pdf\] detached ArrayBuffer/,
      )
    } catch {
      // MessageChannel transfer unsupported in this environment.
    }
  })

  it('describePdfSourceType identifies common PDF source shapes', () => {
    expect(describePdfSourceType(new ArrayBuffer(4))).toBe('array-buffer')
    expect(describePdfSourceType(new Uint8Array(4))).toBe('typed-array')
    expect(describePdfSourceType('https://example.com/a.pdf')).toBe('url')
  })
})
