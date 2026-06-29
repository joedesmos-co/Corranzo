import { describe, expect, it } from 'vitest'
import { buildOmrMusicXml } from '../src/features/omr/buildOmrMusicXml.js'
import {
  clearOmrGeneratedPlaybackSource,
  cloneMusicXmlSource,
  createMusicXmlSource,
  describeMusicXmlSource,
  hasUploadedScoreTiming,
  isLibraryScoreTimingReady,
  isMusicXmlSourceReady,
  isPracticePlaybackReady,
  rebuildMusicXmlSourceFromSessionMeta,
  shouldShowLibraryOmrPanel,
  validateRestoredOmrPlayback,
} from '../src/features/import/musicXmlSource.js'
import { buildSessionMeta, validateRestoredSession } from '../src/features/session/sessionPersistence.js'

const sampleOmrXml = buildOmrMusicXml({
  title: 'Test',
  measures: [
    {
      measureNumber: 1,
      uncertain: false,
      events: [
        {
          type: 'note',
          startDivision: 0,
          durationDivisions: 4,
          durationType: 'quarter',
          notes: [{ midi: 60 }],
        },
      ],
    },
  ],
})

const sampleOmrMeta = {
  durationSeconds: 5,
  noteCount: 1,
  measureCount: 1,
  title: 'Test',
  pdfFingerprint: 'score.pdf::10::1',
  pdfFileName: 'score.pdf',
  createdAt: '2026-06-27T12:00:00.000Z',
}

describe('musicXmlSource', () => {
  it('creates an owned buffer from generated MusicXML text', () => {
    const xml = '<?xml version="1.0"?><score-partwise></score-partwise>'
    const source = createMusicXmlSource('demo.omr.musicxml', xml, { source: 'omr' })
    expect(source.fileName).toBe('demo.omr.musicxml')
    expect(source.source).toBe('omr')
    expect(source.data.byteLength).toBeGreaterThan(0)
    expect(new TextDecoder().decode(source.data)).toBe(xml)
  })

  it('detects unusable detached buffers safely', () => {
    const source = createMusicXmlSource('a.musicxml', '<score-partwise/>')
    expect(isMusicXmlSourceReady(source)).toBe(true)
    const summary = describeMusicXmlSource(source)
    expect(summary.ready).toBe(true)
    expect(summary.byteLength).toBeGreaterThan(0)
  })

  it('requires validated OMR duration before practice opens', () => {
    const invalidOmr = createMusicXmlSource('a.omr.musicxml', '<score-partwise/>', {
      source: 'omr',
      omrMeta: { durationSeconds: 0, noteCount: 0 },
    })
    expect(
      isPracticePlaybackReady({
        restoreGateOpen: true,
        pdfFile: 'blob:pdf',
        musicXmlSource: invalidOmr,
      }),
    ).toBe(false)

    const validOmr = createMusicXmlSource('a.omr.musicxml', '<score-partwise/>', {
      source: 'omr',
      omrMeta: { ...sampleOmrMeta, durationSeconds: 12, noteCount: 8 },
    })
    expect(
      isPracticePlaybackReady({
        restoreGateOpen: true,
        pdfFile: 'blob:pdf',
        musicXmlSource: validOmr,
      }),
    ).toBe(true)
  })

  it('clears generated OMR playback without discarding uploaded MusicXML sources', () => {
    const uploaded = createMusicXmlSource('uploaded.musicxml', sampleOmrXml)
    expect(clearOmrGeneratedPlaybackSource(uploaded)).toBe(uploaded)

    const generated = createMusicXmlSource('score.omr.musicxml', sampleOmrXml, {
      source: 'omr',
      omrMeta: sampleOmrMeta,
    })
    expect(clearOmrGeneratedPlaybackSource(generated)).toBeNull()
  })

  it('clones MusicXML buffers for restore safety', () => {
    const source = createMusicXmlSource('a.omr.musicxml', sampleOmrXml, {
      source: 'omr',
      omrMeta: { ...sampleOmrMeta, durationSeconds: 12, noteCount: 1 },
    })
    const cloned = cloneMusicXmlSource(source)
    expect(cloned).not.toBe(source)
    expect(cloned.data).not.toBe(source.data)
    expect(cloned.source).toBe('omr')
    expect(cloned.omrMeta.durationSeconds).toBe(12)
  })

  it('rebuilds OMR metadata from saved session meta', () => {
    const data = new TextEncoder().encode(sampleOmrXml).buffer
    const rebuilt = rebuildMusicXmlSourceFromSessionMeta('score.omr.musicxml', data, {
      musicXmlSourceKind: 'omr',
      omrMeta: { ...sampleOmrMeta, durationSeconds: 8, noteCount: 4, measureCount: 1 },
    })
    expect(rebuilt.source).toBe('omr')
    expect(rebuilt.omrMeta.durationSeconds).toBe(8)
  })

  it('rejects restored OMR playback without valid metadata or notes', () => {
    const invalid = createMusicXmlSource('a.omr.musicxml', '<score-partwise/>', {
      source: 'omr',
      omrMeta: { durationSeconds: 5, noteCount: 0 },
    })
    expect(validateRestoredOmrPlayback(invalid).ok).toBe(false)

    const valid = createMusicXmlSource('a.omr.musicxml', sampleOmrXml, {
      source: 'omr',
      omrMeta: sampleOmrMeta,
    })
    expect(validateRestoredOmrPlayback(valid).ok).toBe(true)
  })

  it('persists OMR metadata in session meta and skips stale OMR restore', () => {
    const source = createMusicXmlSource('score.omr.musicxml', sampleOmrXml, {
      source: 'omr',
      omrMeta: { ...sampleOmrMeta, durationSeconds: 9 },
    })
    const meta = buildSessionMeta({
      pdfMeta: { fileName: 'score.pdf', size: 10, lastModified: 1 },
      musicXmlSource: source,
      activeView: 'practice',
      pageNumber: 1,
      practicePrefs: null,
    })
    expect(meta.musicXmlSourceKind).toBe('omr')
    expect(meta.omrMeta.durationSeconds).toBe(9)

    const pdfBuffer = new ArrayBuffer(10)
    const musicXmlBuffer = source.data.slice(0)
    const stale = validateRestoredSession(
      {
        pdfMeta: meta.pdfMeta,
        musicXmlFileName: meta.musicXmlFileName,
        musicXmlSize: meta.musicXmlSize,
        musicXmlSourceKind: 'omr',
        omrMeta: null,
      },
      { pdf: pdfBuffer, musicXml: musicXmlBuffer },
    )
    expect(stale.musicXmlSource).toBeNull()
    expect(stale.issues).toContain('stale-omr-session')
    expect(stale.ok).toBe(true)
    expect(stale.pdfFile).toBeTruthy()
  })

  it('distinguishes uploaded timing from experimental OMR for Library UI', () => {
    const uploaded = createMusicXmlSource('piece.musicxml', sampleOmrXml)
    expect(hasUploadedScoreTiming(uploaded)).toBe(true)
    expect(isLibraryScoreTimingReady(uploaded)).toBe(true)
    expect(
      shouldShowLibraryOmrPanel({ hasPdf: true, musicXmlSource: uploaded }),
    ).toBe(false)

    const validOmr = createMusicXmlSource('score.omr.musicxml', sampleOmrXml, {
      source: 'omr',
      omrMeta: sampleOmrMeta,
    })
    expect(hasUploadedScoreTiming(validOmr)).toBe(false)
    expect(isLibraryScoreTimingReady(validOmr)).toBe(true)
    expect(
      shouldShowLibraryOmrPanel({ hasPdf: true, musicXmlSource: validOmr }),
    ).toBe(false)

    const invalidOmr = createMusicXmlSource('score.omr.musicxml', sampleOmrXml, {
      source: 'omr',
      omrMeta: { durationSeconds: 0, noteCount: 0 },
    })
    expect(isLibraryScoreTimingReady(invalidOmr)).toBe(false)
    expect(
      shouldShowLibraryOmrPanel({ hasPdf: true, musicXmlSource: invalidOmr }),
    ).toBe(true)

    const ghostFileName = { fileName: 'stale.omr.musicxml', source: 'omr' }
    expect(isLibraryScoreTimingReady(ghostFileName)).toBe(false)
    expect(
      shouldShowLibraryOmrPanel({ hasPdf: true, musicXmlSource: ghostFileName }),
    ).toBe(true)

    expect(shouldShowLibraryOmrPanel({ hasPdf: true, musicXmlSource: null })).toBe(true)
    expect(shouldShowLibraryOmrPanel({ hasPdf: false, musicXmlSource: null })).toBe(false)
  })
})
