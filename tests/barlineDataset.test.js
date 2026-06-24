import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BARLINE_DATASET_VERSION,
  BARLINE_LABEL,
  BARLINE_LABEL_VALUES,
  DETECTOR_DECISION,
  buildBarlineSampleId,
  buildBarlineSampleRecord,
  buildCropRelativePath,
  mergeBarlineLabels,
  summarizeBarlineLabels,
  validateBarlineDatasetManifest,
  validateBarlineLabelsFile,
  validateBarlineSample,
} from '../src/features/score-follow/barlineDataset.js'
import { exportBarlineSamplesFromPage } from '../scripts/lib/barlineDatasetExport.mjs'
import { cleanPianoPage } from './helpers/syntheticScore.js'
import {
  suggestLabelForSample,
  isLowConfidenceSuggestion,
  summarizeAssistStats,
} from '../tools/barline-labeler/barlineLabelSuggestion.js'

describe('barlineDataset schema', () => {
  it('defines six human label categories', () => {
    expect(BARLINE_LABEL_VALUES).toHaveLength(6)
    expect(BARLINE_LABEL_VALUES).toContain(BARLINE_LABEL.REAL_BARLINE)
    expect(BARLINE_LABEL_VALUES).toContain(BARLINE_LABEL.FAKE_STEM)
    expect(BARLINE_LABEL_VALUES).toContain(BARLINE_LABEL.MISSING_BARLINE)
  })

  it('builds stable sample ids and crop paths', () => {
    const id = buildBarlineSampleId({ pieceId: 'minuet-in-g', page: 1, systemIndex: 0, xPx: 234 })
    expect(id).toBe('minuet-in-g-p1-s0-x234')
    expect(buildCropRelativePath(id)).toBe('crops/minuet-in-g-p1-s0-x234.png')
  })

  it('validates manifest samples', () => {
    const sample = buildBarlineSampleRecord({
      pieceId: 'synthetic-clean-1page',
      page: 1,
      systemIndex: 0,
      x: 0.42,
      xPx: 420,
      expectedMeasuresPerSystem: 4,
      features: {
        treble: { maxRunFrac: 0.9, inkFrac: 0.2, transitions: 2 },
        bass: { maxRunFrac: 0.88, inkFrac: 0.18, transitions: 2 },
        gap: { maxRunFrac: 0.3, inkFrac: 0.05, transitions: 4 },
        full: { maxRunFrac: 0.95, inkFrac: 0.25, transitions: 6 },
        stemSignals: 0,
        trebleStrong: true,
        bassStrong: true,
        gapStrong: false,
        fullStrong: true,
        hasBarlineShape: true,
        score: 2.4,
      },
      detector: {
        decision: DETECTOR_DECISION.ACCEPTED_HIGH,
        confidence: 'high',
        rejectReason: null,
        finalAccepted: true,
      },
    })

    expect(validateBarlineSample(sample).ok).toBe(true)

    const manifest = {
      version: BARLINE_DATASET_VERSION,
      generatedAt: new Date().toISOString(),
      samples: [sample],
    }
    expect(validateBarlineDatasetManifest(manifest).ok).toBe(true)
  })

  it('rejects invalid labels', () => {
    const result = validateBarlineLabelsFile({
      version: BARLINE_DATASET_VERSION,
      labels: { 'sample-1': 'not-a-label' },
    })
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/invalid label/)
  })

  it('merges and summarizes labels', () => {
    const merged = mergeBarlineLabels(
      { version: 1, labels: { a: BARLINE_LABEL.REAL_BARLINE } },
      { b: BARLINE_LABEL.FAKE_STEM },
    )
    expect(validateBarlineLabelsFile(merged).ok).toBe(true)
    const summary = summarizeBarlineLabels(merged)
    expect(summary.total).toBe(2)
    expect(summary.counts[BARLINE_LABEL.REAL_BARLINE]).toBe(1)
  })
})

describe('barlineDataset export', () => {
  it('exports manifest-shaped samples from a synthetic page (dry-run)', async () => {
    const page = cleanPianoPage({ systems: 2, measuresPerSystem: 4 })
    const samples = await exportBarlineSamplesFromPage({
      imageData: page,
      pieceId: 'synthetic-clean-1page',
      pageNumber: 1,
      expectedMeasuresPerSystem: 4,
      options: { dryRun: true, maxPerSystem: 20 },
    })

    expect(samples.length).toBeGreaterThan(0)
    expect(samples.every((s) => s.id && s.features && s.detector)).toBe(true)
    expect(samples.some((s) => s.detector.decision === DETECTOR_DECISION.ACCEPTED_HIGH)).toBe(true)

    const manifest = {
      version: BARLINE_DATASET_VERSION,
      generatedAt: new Date().toISOString(),
      samples,
    }
    expect(validateBarlineDatasetManifest(manifest).ok).toBe(true)
  })
})

const __barlineTestDir = dirname(fileURLToPath(import.meta.url))

describe('barline labeler static UX', () => {
  const html = readFileSync(
    join(__barlineTestDir, '..', 'tools', 'barline-labeler', 'index.html'),
    'utf8',
  )

  it('includes accuracy-focused labeling UX', () => {
    expect(html).toMatch(/cropCanvas/)
    expect(html).toMatch(/image-rendering:\s*pixelated/)
    expect(html).toMatch(/id="prevBtn"/)
    expect(html).toMatch(/id="nextBtn"/)
    expect(html).toMatch(/progressFill/)
    expect(html).toMatch(/pieceFilter/)
    expect(html).toMatch(/localStorage/)
    expect(html).toMatch(/undoBtn/)
    expect(html).toMatch(/analyzeVerticalRuns/)
    expect(html).toMatch(/magnifier/)
    expect(html).toMatch(/exampleGallery/)
    expect(html).toMatch(/<kbd>1<\/kbd>\s*real barline/)
    expect(html).toMatch(/assistedModeToggle/)
    expect(html).toMatch(/lowConfidenceToggle/)
    expect(html).toMatch(/suggestionBanner/)
    expect(html).toMatch(/acceptSuggestionBtn/)
    expect(html).toMatch(/labelMeta/)
    expect(html).toMatch(/barlineLabelSuggestion\.js/)
    expect(html).toMatch(/event\.key === 'Enter'/)
    expect(html).toMatch(/Backspace/)
    expect(html).toMatch(/viewToolbar/)
    expect(html).toMatch(/data-view="raw"/)
    expect(html).toMatch(/viewMode/)
    expect(html).toMatch(/crop-stage--raw/)
  })
})

describe('barline label suggestion', () => {
  const strongRealBarlineFeatures = {
    hasBarlineShape: true,
    trebleStrong: true,
    bassStrong: true,
    fullStrong: true,
    stemSignals: 0,
    treble: { maxRunFrac: 0.86, inkFrac: 0.2, transitions: 2 },
    bass: { maxRunFrac: 0.84, inkFrac: 0.18, transitions: 2 },
    full: { maxRunFrac: 0.91, inkFrac: 0.24, transitions: 3 },
  }

  it('maps accepted-high with strong shape evidence to real barline', () => {
    const suggestion = suggestLabelForSample({
      detector: { decision: 'accepted-high', confidence: 'high', finalAccepted: true },
      features: strongRealBarlineFeatures,
    })
    expect(suggestion.label).toBe(BARLINE_LABEL.REAL_BARLINE)
    expect(suggestion.confidence).toBeGreaterThanOrEqual(0.8)
    expect(suggestion.confidenceLabel).toBe('high')
    expect(isLowConfidenceSuggestion(suggestion)).toBe(false)
  })

  it('suggests unsure for weak-run rejects that could still be real barlines', () => {
    const suggestion = suggestLabelForSample({
      detector: { decision: 'rejected', rejectReason: 'weak-run' },
      features: {
        hasBarlineShape: true,
        trebleStrong: true,
        bassStrong: false,
        fullStrong: false,
        stemSignals: 1,
        treble: { maxRunFrac: 0.55, transitions: 3 },
        bass: { maxRunFrac: 0.32, transitions: 4 },
        full: { maxRunFrac: 0.58, transitions: 5 },
      },
    })
    expect(suggestion.label).toBe(BARLINE_LABEL.UNSURE)
    expect(suggestion.label).not.toBe(BARLINE_LABEL.FAKE_NOTEHEAD_CLUSTER)
    expect(suggestion.label).not.toBe(BARLINE_LABEL.MISSING_BARLINE)
    expect(isLowConfidenceSuggestion(suggestion)).toBe(true)
  })

  it('maps stem-like single-staff evidence to fake stem', () => {
    const suggestion = suggestLabelForSample({
      detector: { decision: 'rejected', rejectReason: 'single-staff' },
      features: {
        stemSignals: 1,
        trebleStrong: true,
        bassStrong: false,
        treble: { maxRunFrac: 0.7, transitions: 4 },
        bass: { maxRunFrac: 0.18, transitions: 2 },
        full: { maxRunFrac: 0.45, transitions: 6 },
      },
    })
    expect(suggestion.label).toBe(BARLINE_LABEL.FAKE_STEM)
  })

  it('requires blob evidence for fake notehead cluster', () => {
    const withEvidence = suggestLabelForSample({
      detector: { decision: 'rejected', rejectReason: 'stem-like' },
      features: {
        stemSignals: 3,
        treble: { maxRunFrac: 0.35, transitions: 10, inkFrac: 0.14 },
        bass: { maxRunFrac: 0.28, transitions: 7 },
        full: { maxRunFrac: 0.4, transitions: 12 },
      },
    })
    expect(withEvidence.label).toBe(BARLINE_LABEL.FAKE_NOTEHEAD_CLUSTER)

    const weakRejectOnly = suggestLabelForSample({
      detector: { decision: 'rejected', rejectReason: 'weak-run' },
      features: {
        stemSignals: 2,
        treble: { maxRunFrac: 0.5, transitions: 3 },
        bass: { maxRunFrac: 0.48, transitions: 2 },
        full: { maxRunFrac: 0.52, transitions: 4 },
      },
    })
    expect(weakRejectOnly.label).toBe(BARLINE_LABEL.UNSURE)
    expect(weakRejectOnly.label).not.toBe(BARLINE_LABEL.FAKE_NOTEHEAD_CLUSTER)
  })

  it('returns unsure for ambiguous low-confidence cases', () => {
    const suggestion = suggestLabelForSample({
      detector: { decision: 'rejected', rejectReason: 'weak-gap-span' },
      features: {
        stemSignals: 1,
        hasBarlineShape: false,
        gapStrong: false,
        treble: { maxRunFrac: 0.4 },
        bass: { maxRunFrac: 0.38 },
        full: { maxRunFrac: 0.42, transitions: 4 },
      },
    })
    expect(suggestion.label).toBe(BARLINE_LABEL.UNSURE)
    expect(isLowConfidenceSuggestion(suggestion)).toBe(true)
  })

  it('does not overstate confidence on accepted-low barlines', () => {
    const suggestion = suggestLabelForSample({
      detector: { decision: 'accepted-low', confidence: 'low' },
      features: {
        hasBarlineShape: true,
        trebleStrong: true,
        bassStrong: true,
        fullStrong: false,
        stemSignals: 1,
        treble: { maxRunFrac: 0.58 },
        bass: { maxRunFrac: 0.56 },
        full: { maxRunFrac: 0.62, transitions: 4 },
      },
    })
    expect(suggestion.label).toBe(BARLINE_LABEL.REAL_BARLINE)
    expect(suggestion.confidence).toBeLessThan(0.65)
    expect(suggestion.confidenceLabel).toBe('low')
  })

  it('summarizes assist stats from labelMeta', () => {
    const stats = summarizeAssistStats({
      a: { source: 'accepted' },
      b: { source: 'corrected' },
      c: { source: 'accepted' },
    })
    expect(stats).toEqual({ accepted: 2, corrected: 1, total: 3 })
  })
})
