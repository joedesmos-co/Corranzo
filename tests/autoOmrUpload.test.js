import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AUTO_OMR_PRECEDENCE,
  buildAutoOmrRequestKey,
  buildAutoOmrRequestFromPdfMeta,
  shouldQueueAutoOmr,
  shouldAcceptOmrGeneratedResult,
  cancelInFlightOmrGeneration,
  pdfPreparingScoreMessage,
} from '../src/features/library/autoOmrOrchestration.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

vi.mock('../src/features/omr/runPdfOmrClient.js', () => ({
  cancelActiveOmrWorker: vi.fn(),
}))

import { cancelActiveOmrWorker } from '../src/features/omr/runPdfOmrClient.js'

describe('auto OMR orchestration helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('documents source precedence with MusicXML before MIDI before OMR', () => {
    expect(AUTO_OMR_PRECEDENCE.uploadedMusicXml).toBeLessThan(
      AUTO_OMR_PRECEDENCE.uploadedMidiPlayback,
    )
    expect(AUTO_OMR_PRECEDENCE.uploadedMidiPlayback).toBeLessThan(
      AUTO_OMR_PRECEDENCE.omrGeneratedTiming,
    )
    expect(AUTO_OMR_PRECEDENCE.omrGeneratedTiming).toBeLessThan(AUTO_OMR_PRECEDENCE.pdfAlone)
  })

  it('builds a stable idempotent request key from PDF identity + instrument', () => {
    const file = { name: 'score.pdf', size: 1200, lastModified: 99 }
    const a = buildAutoOmrRequestKey(file, 'piano')
    const b = buildAutoOmrRequestKey(file, 'piano')
    const c = buildAutoOmrRequestKey({ ...file, size: 1201 }, 'piano')
    expect(a).toEqual(b)
    expect(a.key).not.toEqual(c.key)
    expect(a.pdfFileName).toBe('score.pdf')
  })

  it('rebuilds the same key from restored pdfMeta', () => {
    const file = { name: 'restored.pdf', size: 40, lastModified: 7 }
    const fromFile = buildAutoOmrRequestKey(file, 'guitar')
    const fromMeta = buildAutoOmrRequestFromPdfMeta(
      { fileName: 'restored.pdf', size: 40, lastModified: 7 },
      'guitar',
    )
    expect(fromMeta).toEqual(fromFile)
  })

  it('queues PDF-only and PDF+MIDI, but not uploaded MusicXML or usable OMR', () => {
    expect(shouldQueueAutoOmr({ musicXmlSource: null })).toBe(true)
    expect(shouldQueueAutoOmr({ musicXmlSource: undefined })).toBe(true)
    expect(
      shouldQueueAutoOmr({
        musicXmlSource: { source: 'upload', data: new ArrayBuffer(4), fileName: 'a.mxl' },
      }),
    ).toBe(false)
    expect(
      shouldQueueAutoOmr({
        musicXmlSource: {
          source: 'omr',
          data: new ArrayBuffer(4),
          fileName: 'a.omr.musicxml',
          omrMeta: {
            noteCount: 1,
            measureCount: 1,
            durationSeconds: 1,
            title: 'a',
            pdfFingerprint: 'fp',
            pdfFileName: 'a.pdf',
            createdAt: new Date().toISOString(),
          },
        },
      }),
    ).toBe(false)
  })

  it('rejects late OMR when uploaded timing already owns the session', () => {
    const rejected = shouldAcceptOmrGeneratedResult({
      musicXmlSource: { source: 'upload', data: new ArrayBuffer(2), fileName: 't.musicxml' },
      currentInstrumentId: 'piano',
      sourceInstrumentId: 'piano',
      sourcePdfFileName: 'score.pdf',
      currentPdfFileName: 'score.pdf',
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.reason).toBe('uploaded-timing-owns-session')
  })

  it('rejects stale OMR when PDF or instrument identity changed', () => {
    expect(
      shouldAcceptOmrGeneratedResult({
        musicXmlSource: null,
        sourceInstrumentId: 'piano',
        currentInstrumentId: 'guitar',
        sourcePdfFileName: 'a.pdf',
        currentPdfFileName: 'a.pdf',
      }).reason,
    ).toBe('instrument-mismatch')
    expect(
      shouldAcceptOmrGeneratedResult({
        musicXmlSource: null,
        sourceInstrumentId: 'piano',
        currentInstrumentId: 'piano',
        sourcePdfFileName: 'old.pdf',
        currentPdfFileName: 'new.pdf',
      }).reason,
    ).toBe('pdf-name-mismatch')
    expect(
      shouldAcceptOmrGeneratedResult({
        musicXmlSource: null,
        sourceInstrumentId: 'piano',
        currentInstrumentId: 'piano',
        sourcePdfFileUrl: 'blob:old',
        currentPdfFileUrl: 'blob:new',
        sourcePdfFileName: 'a.pdf',
        currentPdfFileName: 'a.pdf',
      }).reason,
    ).toBe('pdf-url-mismatch')
  })

  it('accepts OMR when the session still needs generated timing', () => {
    const accepted = shouldAcceptOmrGeneratedResult({
      musicXmlSource: null,
      sourceInstrumentId: 'piano',
      currentInstrumentId: 'piano',
      sourcePdfFileName: 'score.pdf',
      currentPdfFileName: 'score.pdf',
      sourcePdfFileUrl: 'blob:1',
      currentPdfFileUrl: 'blob:1',
    })
    expect(accepted).toEqual({ ok: true })
  })

  it('cancels in-flight workers and clears the auto-request queue', () => {
    const setAutoOmrRequest = vi.fn()
    cancelInFlightOmrGeneration(setAutoOmrRequest)
    expect(cancelActiveOmrWorker).toHaveBeenCalledTimes(1)
    expect(setAutoOmrRequest).toHaveBeenCalledWith(null)
  })

  it('uses Preparing score wording in upload feedback', () => {
    expect(pdfPreparingScoreMessage('piece.pdf')).toContain('Preparing score')
    expect(pdfPreparingScoreMessage('piece.pdf', { clearedCompanionFiles: true })).toContain(
      'Previous timing and sound files were cleared',
    )
  })
})

describe('auto OMR upload wiring', () => {
  const app = readSrc('App.jsx')
  const library = readSrc('components', 'LibraryPanel.jsx')
  const omrPanel = readSrc('components', 'library', 'PdfOmrPlaybackPanel.jsx')
  const orchestration = readSrc('features', 'library', 'autoOmrOrchestration.js')

  it('queues local preparation automatically for PDF-only uploads from one orchestration helper', () => {
    expect(app).toContain("from './features/library/autoOmrOrchestration.js'")
    expect(app).toMatch(
      /handleFileSelect[\s\S]*setAutoOmrRequest\(buildAutoOmrRequest\(file, activeInstrumentRef\.current\)\)/,
    )
    expect(app).toContain('pdfPreparingScoreMessage')
    expect(orchestration).toContain('PDF + MIDI without MusicXML still runs OMR')
  })

  it('never queues OMR when uploaded MusicXML timing is present', () => {
    expect(app).toMatch(
      /handleMusicXmlSelect[\s\S]*cancelInFlightOmrGeneration\(setAutoOmrRequest\)[\s\S]*source: 'upload'/,
    )
    expect(app).toMatch(
      /if \(classified\.pdf\[0\]\) \{[\s\S]*if \(loadedXml\?\.data \|\| !shouldQueueAutoOmr/,
    )
    expect(app).toContain('clearScoreFollowAnchors')
  })

  it('keeps MIDI as playback-only and does not cancel preparation when MIDI arrives alone', () => {
    expect(app).toMatch(
      /if \(classified\.midi\[0\]\) \{[\s\S]*MIDI is playback-only[\s\S]*do not cancel score preparation/,
    )
    expect(orchestration).toContain('authoritative **playback audio** only')
  })

  it('rejects stale OMR via shouldAcceptOmrGeneratedResult including uploaded-timing ownership', () => {
    expect(app).toContain('shouldAcceptOmrGeneratedResult')
    expect(app).toContain('sourcePdfFileName = null')
    expect(app).toContain('sourcePdfFileUrl = null')
    expect(app).toContain('sourceInstrumentId = null')
  })

  it('opens Practice after App accepts generated MusicXML without requiring MIDI', () => {
    expect(app).toContain('function isPracticeNavigableSet')
    expect(app).toMatch(
      /setMusicXmlSource\(nextMusicXmlSource\)[\s\S]*setAutoOmrRequest\(null\)[\s\S]*navigateToView\('practice'\)/,
    )
    expect(app).toContain("activeView: 'practice'")
    expect(app).toContain('Ready to practice')
  })

  it('restores session with auto-queue only when PDF has no usable timing', () => {
    expect(app).toMatch(
      /shouldQueueAutoOmr\(\{ musicXmlSource: nextMusicXml \}\) && payload\.pdfMeta\?\.fileName/,
    )
    expect(app).toContain('buildAutoOmrRequestFromPdfMeta')
  })

  it('auto-starts once per key; Retry only after failure; no Generate on happy path', () => {
    expect(omrPanel).toContain('autoStartKey = null')
    expect(omrPanel).toContain('autoStartedKeyRef')
    expect(omrPanel).toMatch(/onAutoStartConsumed\?\.\(autoStartKey\)[\s\S]*handleGenerate\(\)/)
    expect(omrPanel).toContain('Preparing score')
    expect(omrPanel).toContain('Try again')
    expect(omrPanel).toContain('Cancel')
    expect(omrPanel).toContain('showRetry')
    expect(omrPanel).not.toContain('Generate timing from PDF')
    expect(omrPanel).not.toContain('Generate experimental playback from PDF')
  })

  it('scopes auto-start requests to the visible PDF and remounts the panel on PDF identity change', () => {
    expect(library).toMatch(/autoOmrRequest\?\.instrumentId === instrumentId/)
    expect(library).toMatch(/autoOmrRequest\?\.pdfFileName === fileName/)
    expect(library).toMatch(/autoStartKey=\{autoOmrRequestForCurrentPdf\?\.key \?\? null\}/)
    expect(library).toMatch(/key=\{`omr-panel-\$\{fileName/)
    expect(app).toContain('autoOmrRequest={autoOmrRequest}')
    expect(app).toContain('onAutoOmrRequestConsumed={() => setAutoOmrRequest(null)}')
  })
})
