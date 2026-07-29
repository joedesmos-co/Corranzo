import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import {
  RECOGNITION_PROBLEM_CATEGORIES,
  assertRecognitionReportOwnership,
  buildGeneratedSummaryJson,
  buildRecognitionProvenanceJson,
  buildRecognitionReportJson,
  buildRecognitionReportPackage,
  buildRecognitionReportZipFilename,
  sanitizeReportFilename,
  sanitizeUserReportText,
  zipRecognitionReportPackage,
} from '../src/features/omr/recognitionProblemReport/index.js'

const root = join(import.meta.dirname, '..')
function readSrc(...parts) {
  return readFileSync(join(root, 'src', ...parts), 'utf8')
}

function baseScoreContext(overrides = {}) {
  const activeScore = {
    scoreId: 'score-active-1',
    generation: 3,
    pdf: {
      identity: 'pdf-hash-abc',
      contentHash: 'abc12345',
      fileName: 'demo.pdf',
      meta: { fileName: 'demo.pdf', numPages: 2, byteLength: 4096 },
    },
    musicXml: { sourceType: 'omr', ownerScoreId: 'score-active-1' },
  }
  const musicXmlSource = {
    ownerScoreId: 'score-active-1',
    source: 'omr',
    fileName: 'demo.omr.musicxml',
    omrMeta: {
      noteCount: 48,
      measureCount: 12,
      durationSeconds: 24,
      quality: {
        acceptance: 'warning',
        confidenceBand: 'mid',
        warningReasons: ['mid-confidence-with-structure'],
        ownerScoreId: 'score-active-1',
        safetyChecks: { musicXmlParsed: true, nonzeroPlayableEvents: true },
        extractionSummary: { noteCount: 48, measureCount: 12, overallConfidence: 0.61 },
        overallConfidence: 0.61,
      },
    },
  }
  return {
    activeScore,
    musicXmlSource,
    pdfMeta: { fileName: 'demo.pdf', numPages: 2, byteLength: 4096 },
    pdfBuffer: new Uint8Array([37, 80, 68, 70, ...new Array(100).fill(1)]).buffer,
    instrumentId: 'piano',
    generation: 3,
    timingMap: {
      parts: [{ id: 'P1', name: 'Piano', staves: 2 }],
      measures: [{ number: 1 }, { number: 2 }],
      notes: [
        { midi: 60, measureNumber: 1, type: 'quarter', quarterTime: 0 },
        { midi: 64, measureNumber: 1, type: 'quarter', quarterTime: 1, isChord: true },
        { isRest: true, measureNumber: 2, type: 'half', quarterTime: 2 },
      ],
      timeSignatures: [{ beats: 4, beatType: 4, quarterTime: 0 }],
      keySignatures: [{ fifths: 0, mode: 'major', quarterTime: 0 }],
      tempoChanges: [{ bpm: 90, quarterTime: 0 }],
      notation: { hasStandardStaff: true, hasTabStaff: false },
    },
    diagnostics: null,
    ...overrides,
  }
}

describe('recognition problem report — privacy & package', () => {
  it('default export excludes PDF bytes', async () => {
    const pkg = buildRecognitionReportPackage({
      ...baseScoreContext(),
      category: 'wrong-notes',
      includeOriginalPdf: false,
      pdfConfirmed: false,
    })
    expect(pkg.ok).toBe(true)
    expect(pkg.files['original-score.pdf']).toBeUndefined()
    expect(pkg.report.privacy.originalPdfIncluded).toBe(false)
    expect(pkg.files['report.json']).toContain('"originalPdfIncluded": false')
    expect(pkg.files['README.txt']).toMatch(/not included unless you explicitly choose/i)
    const blob = await zipRecognitionReportPackage(pkg)
    const zip = await JSZip.loadAsync(blob)
    expect(Object.keys(zip.files).sort()).toEqual([
      'README.txt',
      'generated-summary.json',
      'provenance.json',
      'report.json',
    ])
  })

  it('explicit PDF inclusion requires confirmation', () => {
    const denied = buildRecognitionReportPackage({
      ...baseScoreContext(),
      includeOriginalPdf: true,
      pdfConfirmed: false,
    })
    expect(denied.ok).toBe(false)
    expect(denied.reason).toBe('pdf-confirmation-required')

    const allowed = buildRecognitionReportPackage({
      ...baseScoreContext(),
      includeOriginalPdf: true,
      pdfConfirmed: true,
    })
    expect(allowed.ok).toBe(true)
    expect(allowed.pdfIncluded).toBe(true)
    expect(allowed.files['original-score.pdf']).toBeInstanceOf(Uint8Array)
    expect(allowed.report.privacy.originalPdfIncluded).toBe(true)
  })

  it('sanitized filenames contain no path information', () => {
    expect(sanitizeReportFilename('/Users/secret/Scores/My Piece.pdf')).toBe('My Piece.pdf')
    expect(sanitizeReportFilename('C:\\\\Users\\\\me\\\\Downloads\\\\score.pdf')).toBe('score.pdf')
    expect(sanitizeReportFilename('../../etc/passwd')).toBe('passwd')
    const report = buildRecognitionReportJson({
      ...baseScoreContext(),
      pdfMeta: { fileName: '/tmp/private/nested/demo.pdf' },
    })
    expect(report.score.sanitizedSourceFilename).toBe('demo.pdf')
    expect(JSON.stringify(report)).not.toMatch(/\/tmp\/private/)
  })

  it('report belongs to active score and includes warning metadata', () => {
    const report = buildRecognitionReportJson(baseScoreContext())
    expect(report.score.activeScoreId).toBe('score-active-1')
    expect(report.recognition.acceptance).toBe('warning')
    expect(report.recognition.confidenceBand).toBe('mid')
    expect(report.recognition.warningReasons).toContain('mid-confidence-with-structure')
    expect(report.privacy.fullMusicXmlIncluded).toBe(false)
    expect(report.privacy.localStorageIncluded).toBe(false)
    expect(report.privacy.indexedDbIncluded).toBe(false)
  })

  it('accepted-score metadata is included', () => {
    const ctx = baseScoreContext({
      musicXmlSource: {
        ownerScoreId: 'score-active-1',
        source: 'omr',
        omrMeta: {
          noteCount: 20,
          measureCount: 4,
          quality: {
            acceptance: 'accepted',
            confidenceBand: 'high',
            warningReasons: [],
            ownerScoreId: 'score-active-1',
            overallConfidence: 0.88,
          },
        },
      },
    })
    const report = buildRecognitionReportJson(ctx)
    expect(report.recognition.acceptance).toBe('accepted')
    expect(report.recognition.confidenceBand).toBe('high')
  })

  it('ownership mismatch prevents export', () => {
    const ownership = assertRecognitionReportOwnership({
      activeScoreId: 'score-a',
      omrOwnerScoreId: 'score-a',
      qualityOwnerScoreId: 'score-b',
    })
    expect(ownership.ok).toBe(false)
    expect(ownership.reason).toBe('ownership-mismatch')

    const pkg = buildRecognitionReportPackage({
      ...baseScoreContext({
        musicXmlSource: {
          ownerScoreId: 'score-other',
          source: 'omr',
          omrMeta: {
            quality: { acceptance: 'warning', ownerScoreId: 'score-other', warningReasons: [] },
          },
        },
      }),
    })
    expect(pkg.ok).toBe(false)
    expect(pkg.ownership.reason).toBe('ownership-mismatch')
  })

  it('missing provenance exports safely', () => {
    const provenance = buildRecognitionProvenanceJson({
      diagnostics: null,
      quality: { acceptance: 'warning', ownerScoreId: 'score-active-1' },
      activeScoreId: 'score-active-1',
    })
    expect(provenance.provenanceAvailable).toBe(false)
    expect(provenance.reason).toMatch(/not collected/i)
    expect(provenance.rhythmProvenance).toBeNull()
  })

  it('failed-OMR metadata exports safely', () => {
    const pkg = buildRecognitionReportPackage({
      activeScore: { scoreId: 'score-fail-1', generation: 1, pdf: { fileName: 'scan.pdf' } },
      musicXmlSource: null,
      pdfMeta: { fileName: 'scan.pdf', numPages: 1 },
      pdfBuffer: null,
      mode: 'omr-failure',
      category: 'failed-to-generate',
      failure: {
        stage: 'no-systems',
        exceptionName: 'Error',
        exceptionMessage: 'PDF too difficult for local generation.',
        exceptionStack: null,
        pageCount: 1,
        perPageConfidence: [{ page: 1, confidence: 0.2 }],
        acceptanceGate: { acceptance: 'rejected' },
        failedSafetyChecks: { musicXmlParsed: false },
      },
      omrRunMeta: { runId: 9, stage: 'no-systems' },
    })
    expect(pkg.ok).toBe(true)
    const report = JSON.parse(pkg.files['report.json'])
    expect(report.failure.stage).toBe('no-systems')
    expect(report.failure.exceptionName).toBe('Error')
    expect(report.problem.category).toBe('failed-to-generate')
  })

  it('report size remains bounded', () => {
    const hugeDiagnostics = {
      rhythmProvenance: {
        noteDurationCount: 5000,
        noteDurations: Array.from({ length: 5000 }, (_, i) => ({ id: i, stages: ['a', 'b', 'c'] })),
        dotCandidates: Array.from({ length: 2000 }, (_, i) => ({ id: i })),
        beamCandidates: Array.from({ length: 2000 }, (_, i) => ({ id: i })),
      },
    }
    const provenance = buildRecognitionProvenanceJson({
      diagnostics: hugeDiagnostics,
      activeScoreId: 'score-active-1',
    })
    expect(provenance.rhythmProvenance.noteDurations.length).toBeLessThanOrEqual(120)
    expect(provenance.rhythmProvenance.dotCandidates.length).toBeLessThanOrEqual(120)
    const summary = buildGeneratedSummaryJson({
      timingMap: {
        notes: Array.from({ length: 400 }, (_, i) => ({
          midi: 60 + (i % 12),
          measureNumber: (i % 40) + 1,
          type: 'quarter',
        })),
        measures: Array.from({ length: 40 }, (_, i) => ({ number: i + 1 })),
        parts: [],
      },
    })
    expect(summary.noteSampleLimit).toBe(0)
    expect(JSON.stringify(summary).length).toBeLessThan(50_000)
  })

  it('export filenames are deterministic and safe', () => {
    const name = buildRecognitionReportZipFilename(new Date('2026-07-29T18:07:00'))
    expect(name).toMatch(/^corranzo-recognition-report-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/)
    expect(name).not.toMatch(/[/\\]/)
  })

  it('user-entered text is treated as data, not markup', () => {
    const cleaned = sanitizeUserReportText('<script>alert(1)</script>\nmeasure 4 looks wrong')
    expect(cleaned).toContain('<script>alert(1)</script>')
    expect(cleaned).toContain('measure 4 looks wrong')
    const report = buildRecognitionReportJson({
      ...baseScoreContext(),
      description: '<img src=x onerror=alert(1)> bad chord',
    })
    // Stored as plain string data in JSON — never executed / never HTML-escaped into markup fields.
    expect(report.problem.description).toContain('<img src=x onerror=alert(1)>')
    expect(report.problem.description.includes('\0')).toBe(false)
  })

  it('no unrelated storage is included in package payloads', () => {
    const pkg = buildRecognitionReportPackage(baseScoreContext())
    const report = JSON.parse(pkg.files['report.json'])
    expect(report.privacy.localStorageIncluded).toBe(false)
    expect(report.privacy.indexedDbIncluded).toBe(false)
    expect(report.privacy.accountInfoIncluded).toBe(false)
    expect(pkg.files['report.json']).not.toMatch(/scoreflow-session/)
    expect(Object.keys(pkg.files)).not.toContain('localStorage.json')
    expect(Object.keys(pkg.files)).not.toContain('indexeddb.json')
  })

  it('exposes all required problem categories', () => {
    expect(RECOGNITION_PROBLEM_CATEGORIES.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        'wrong-notes',
        'wrong-rhythm',
        'missing-notes',
        'extra-notes',
        'guitar-tab',
        'failed-to-generate',
        'other',
      ]),
    )
  })
})

describe('recognition problem report — UI wiring contracts', () => {
  it('warning banner exposes a secondary report action', () => {
    const banner = readSrc('components', 'practice', 'OmrQualityWarningBanner.jsx')
    expect(banner).toContain('onReportProblem')
    expect(banner).toContain('Report recognition problem')
  })

  it('Practice Advanced Help and failure panel expose report entry points', () => {
    const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
    expect(panel).toContain('onReportRecognitionProblem')
    expect(panel).toContain('Report recognition problem')
    const omr = readSrc('components', 'library', 'PdfOmrPlaybackPanel.jsx')
    expect(omr).toContain('RecognitionProblemReportDialog')
    expect(omr).toContain('failed-to-generate')
    expect(omr).toContain('failureReport')
  })

  it('dialog supports Escape, focus restore, PDF confirmation, and score-keyed reset', () => {
    const dialog = readSrc('components', 'omr', 'RecognitionProblemReportDialog.jsx')
    expect(dialog).toContain("event.key === 'Escape'")
    expect(dialog).toContain('previousFocusRef')
    expect(dialog).toContain('Include original PDF')
    expect(dialog).toContain('confirmPdf')
    expect(dialog).toContain('ownerScoreId !== trackedOwner')
    expect(dialog).toContain('The original PDF is not included unless you explicitly choose to include it.')
    expect(dialog).toContain('createPortal')
    expect(dialog).toContain('aria-modal')
  })

  it('PracticeView closes report dialog on score replacement', () => {
    const view = readSrc('components', 'practice', 'PracticeView.jsx')
    expect(view).toContain('RecognitionProblemReportDialog')
    expect(view).toContain('setReportOpen(false)')
    expect(view).toContain('scoreKey !== trackedScoreKey')
  })
})
